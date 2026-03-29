/**
 * Repository Code Intelligence Engine — Scheduled Index Runner
 *
 * Periodically re-indexes configured repositories so the delta resolver
 * always has fresh context for PR reviews.
 */

import { indexRepo, type IndexResult } from "./repo-code-indexer";
import { getLatestIndexRun } from "./repo-code-index-store";

// ─── Single repo index run ─────────────────────────────────────────────────────

export async function runIndexForRepo(repoSlug: string, opts?: {
  fullReindex?: boolean;
  commitSha?: string;
}): Promise<IndexResult> {
  const existing = getLatestIndexRun(repoSlug);

  // If a run is already in progress, skip
  if (existing && existing.status === "running") {
    const ageMs = Date.now() - new Date(existing.startedAt).getTime();
    // Only skip if the running job started less than 30 minutes ago
    if (ageMs < 30 * 60 * 1000) {
      console.log(`[RCIE] index already running for repo=${repoSlug} (started ${existing.startedAt}), skipping`);
      return {
        runId: existing.id,
        status: "completed",
        filesIndexed: 0,
        symbolsExtracted: 0,
        dependenciesMapped: 0,
        annotationsFound: 0,
        guardsDetected: 0,
        aiSummariesGenerated: 0,
        durationMs: 0,
      };
    }
  }

  console.log(`[RCIE] starting index for repo=${repoSlug} fullReindex=${opts?.fullReindex ?? false}`);
  const result = await indexRepo({
    repoSlug,
    commitSha: opts?.commitSha,
    fullReindex: opts?.fullReindex ?? false,
    enableAISummaries: (process.env.RCIE_AI_SUMMARIES || "true").toLowerCase() !== "false",
    maxFiles: Math.max(10, Number(process.env.RCIE_MAX_FILES || 500)),
  });

  console.log(
    `[RCIE] repo=${repoSlug} status=${result.status} ` +
    `files=${result.filesIndexed} symbols=${result.symbolsExtracted} ` +
    `deps=${result.dependenciesMapped} guards=${result.guardsDetected} ` +
    `ai=${result.aiSummariesGenerated} duration=${result.durationMs}ms` +
    (result.error ? ` error=${result.error}` : ""),
  );

  return result;
}

// ─── Scheduler ─────────────────────────────────────────────────────────────────

export function scheduleIndexRunner(): void {
  const enabled = (process.env.RCIE_ENABLED || "true").toLowerCase() !== "false";
  if (!enabled) {
    console.log("[RCIE] index runner disabled (RCIE_ENABLED=false)");
    return;
  }

  const repos = (process.env.RCIE_REPOS || process.env.BPE_BATCH_REPOS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (repos.length === 0) {
    console.log("[RCIE] no repos configured (RCIE_REPOS), skipping scheduler");
    return;
  }

  const intervalHours = Math.max(1, Number(process.env.RCIE_INDEX_INTERVAL_HOURS || 12));
  const intervalMs = intervalHours * 60 * 60 * 1000;

  const runAll = async () => {
    for (const repo of repos) {
      try {
        await runIndexForRepo(repo);
      } catch (err) {
        console.error(`[RCIE] scheduler error repo=${repo}`, err);
      }
    }
  };

  // Start first run after a short delay (5 minutes after server boot)
  const initialDelayMs = 5 * 60 * 1000;
  console.log(
    `[RCIE] scheduler armed: ${repos.length} repo(s), interval=${intervalHours}h, ` +
    `first run in ${Math.round(initialDelayMs / 60000)}m`,
  );

  setTimeout(runAll, initialDelayMs);
  setInterval(runAll, intervalMs);
}
