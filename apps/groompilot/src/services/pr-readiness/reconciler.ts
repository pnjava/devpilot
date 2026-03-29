/**
 * Reconciler — Detects PR/Jira state changes and re-enqueues readiness jobs.
 *
 * Bounded polling with configurable TTL. Runs as a background scheduler.
 */

import {
  getPullRequest,
  getPullRequests,
  getRepos,
  type BBPullRequest,
  type BBRepo,
} from "../bitbucket-server";
import { getIssueDetail } from "../jira";
import {
  getWatchState,
  listWatchedPRs,
  saveWatchState,
} from "./snapshot-store";
import { enqueueReadinessJob } from "./job-queue";
import { loadReadinessConfig } from "./types";
import type { PRReadinessRequest, PREventType } from "./types";

// ─── Reconciler Loop ────────────────────────────────────────────────────────

let reconcilerTimer: ReturnType<typeof setTimeout> | null = null;

export function startReconciler(intervalMinutes = 5): void {
  if (reconcilerTimer) return;
  console.log(`[reconciler] starting (interval: ${intervalMinutes}m)`);

  const run = async () => {
    try {
      await reconcileAll();
    } catch (err) {
      console.error("[reconciler] error:", err);
    }
    reconcilerTimer = setTimeout(run, intervalMinutes * 60_000);
  };

  // Initial delay to let the system settle
  reconcilerTimer = setTimeout(run, 30_000);
}

export function stopReconciler(): void {
  if (reconcilerTimer) {
    clearTimeout(reconcilerTimer);
    reconcilerTimer = null;
  }
}

// ─── Core Logic ─────────────────────────────────────────────────────────────

export async function reconcileAll(): Promise<{
  checked: number;
  enqueued: number;
  skipped: number;
  errors: number;
}> {
  const cfg = loadReadinessConfig();
  const watched = listWatchedPRs(cfg.staleTtlMinutes);

  let checked = 0;
  let enqueued = 0;
  let skipped = 0;
  let errors = 0;

  for (const ws of watched) {
    checked++;
    try {
      const result = await reconcileOne(
        ws.provider,
        ws.projectKey,
        ws.repoSlug,
        ws.prId,
      );
      if (result.enqueued) enqueued++;
      else skipped++;
    } catch (err) {
      errors++;
      console.error(
        `[reconciler] error for ${ws.projectKey}/${ws.repoSlug}#${ws.prId}:`,
        err,
      );
    }
  }

  if (checked > 0) {
    console.log(
      `[reconciler] checked=${checked} enqueued=${enqueued} skipped=${skipped} errors=${errors}`,
    );
  }

  return { checked, enqueued, skipped, errors };
}

export async function reconcileOne(
  provider: string,
  projectKey: string,
  repoSlug: string,
  prId: number,
): Promise<{ enqueued: boolean; reason: string }> {
  // Fetch current PR state from Bitbucket
  let pr: BBPullRequest;
  try {
    pr = await getPullRequest(repoSlug, prId);
  } catch {
    return { enqueued: false, reason: "PR fetch failed" };
  }

  // Skip merged/declined PRs
  if (pr.state === "MERGED" || pr.state === "DECLINED") {
    return { enqueued: false, reason: `PR is ${pr.state}` };
  }

  const ws = getWatchState(provider, projectKey, repoSlug, prId);
  if (!ws) {
    return { enqueued: false, reason: "No watch state" };
  }

  // Check for commit changes
  const latestCommit = extractLatestCommit(pr);
  const commitChanged = latestCommit !== ws.latestSeenCommitSha;

  // Check for Jira changes
  const jiraKeys = extractJiraKeys(pr.title, pr.description);
  const jiraFingerprint = jiraKeys.slice().sort().join(",");
  const jiraChanged = jiraFingerprint !== ws.latestJiraFingerprint;

  if (!commitChanged && !jiraChanged) {
    return { enqueued: false, reason: "No changes detected" };
  }

  const eventType: PREventType = commitChanged
    ? "pr:from_ref_updated"
    : "pr:modified";

  const request: PRReadinessRequest = {
    provider: "bitbucket",
    projectKey,
    repoSlug,
    prId,
    prUrl: pr.links?.self?.[0]?.href || "",
    title: pr.title,
    description: pr.description || "",
    author: pr.author?.user?.displayName || "unknown",
    sourceBranch: pr.fromRef?.displayId || "",
    targetBranch: pr.toRef?.displayId || "",
    latestCommitSha: latestCommit,
    eventType,
    eventTimestamp: new Date().toISOString(),
    linkedJiraKeys: jiraKeys,
    dryRun: false,
    reasonForEvaluation: commitChanged
      ? "Reconciler detected new commit"
      : "Reconciler detected Jira changes",
  };

  const result = enqueueReadinessJob(request);

  if (result.enqueued) {
    // Update watch state
    saveWatchState({
      provider: "bitbucket",
      projectKey,
      repoSlug,
      prId,
      latestSeenCommitSha: latestCommit,
      latestJiraFingerprint: jiraFingerprint,
      lastSnapshotId: ws.lastSnapshotId,
      lastRefreshAt: new Date().toISOString(),
    });
  }

  return {
    enqueued: result.enqueued,
    reason: result.enqueued
      ? `Enqueued: ${request.reasonForEvaluation}`
      : "Duplicate job",
  };
}

// ─── Bootstrap — seed all open PRs on startup ──────────────────────────────

export async function bootstrapOpenPRs(
  projectKey?: string,
): Promise<{ repos: number; prs: number; enqueued: number; skipped: number; errors: number }> {
  const project = projectKey || process.env.BITBUCKET_PROJECT || "BMN";
  console.log(`[bootstrap] Fetching open PRs for project ${project}…`);

  let repos: BBRepo[] = [];
  try {
    repos = await getRepos(project);
  } catch (err) {
    console.error("[bootstrap] Failed to fetch repos:", err);
    return { repos: 0, prs: 0, enqueued: 0, skipped: 0, errors: 1 };
  }

  let totalPRs = 0;
  let totalEnqueued = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const repo of repos) {
    let openPRs: BBPullRequest[] = [];
    try {
      openPRs = await getPullRequests(repo.slug, "OPEN");
    } catch {
      totalErrors++;
      continue;
    }

    for (const pr of openPRs) {
      totalPRs++;
      try {
        const jiraKeys = extractJiraKeys(pr.title, pr.description || "");
        const latestCommit = (pr as any).fromRef?.latestCommit ||
          (pr as any).properties?.mergeResult?.current?.id || "";

        const request: PRReadinessRequest = {
          provider: "bitbucket",
          projectKey: project,
          repoSlug: repo.slug,
          prId: pr.id,
          prUrl: pr.links?.self?.[0]?.href || "",
          title: pr.title,
          description: pr.description || "",
          author: pr.author?.user?.displayName || "unknown",
          sourceBranch: pr.fromRef?.displayId || "",
          targetBranch: pr.toRef?.displayId || "",
          latestCommitSha: latestCommit,
          eventType: "pr:opened",
          eventTimestamp: new Date().toISOString(),
          linkedJiraKeys: jiraKeys,
          dryRun: false,
          reasonForEvaluation: "Startup bootstrap",
        };

        const result = enqueueReadinessJob(request);
        if (result.enqueued) totalEnqueued++;
        else totalSkipped++;
      } catch {
        totalErrors++;
      }
    }
  }

  console.log(
    `[bootstrap] project=${project} repos=${repos.length} prs=${totalPRs} enqueued=${totalEnqueued} skipped=${totalSkipped} errors=${totalErrors}`,
  );

  return {
    repos: repos.length,
    prs: totalPRs,
    enqueued: totalEnqueued,
    skipped: totalSkipped,
    errors: totalErrors,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractLatestCommit(pr: BBPullRequest): string {
  // Bitbucket Server includes latestCommit in some API versions
  return (pr as any).properties?.mergeResult?.current?.id ||
    (pr as any).fromRef?.latestCommit ||
    "";
}

/** Extract Jira keys from PR title and description */
export function extractJiraKeys(
  title: string,
  description: string,
): string[] {
  const combined = `${title || ""} ${description || ""}`;
  const matches = combined.match(/[A-Z][A-Z0-9]+-\d+/g);
  return matches ? [...new Set(matches)] : [];
}
