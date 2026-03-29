/**
 * Snapshot Store — Persist and retrieve PR Readiness snapshots from SQLite.
 */

import db from "../../db";
import type {
  PRReadinessSnapshot,
  PRWatchState,
  ReadinessState,
  ReadinessSummaryResponse,
} from "./types";

// ─── Tables ─────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS pr_readiness_snapshots (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL DEFAULT 'bitbucket',
    project_key TEXT NOT NULL,
    repo_slug TEXT NOT NULL,
    pr_id INTEGER NOT NULL,
    pr_title TEXT NOT NULL DEFAULT '',
    pr_author TEXT NOT NULL DEFAULT '',
    latest_commit_sha TEXT NOT NULL,
    diff_fingerprint TEXT NOT NULL DEFAULT '',
    jira_fingerprint TEXT NOT NULL DEFAULT '',
    readiness_state TEXT NOT NULL DEFAULT 'error',
    overall_risk TEXT NOT NULL DEFAULT 'medium',
    deterministic_findings_json TEXT NOT NULL DEFAULT '[]',
    llm_findings_json TEXT NOT NULL DEFAULT '[]',
    final_merged_findings_json TEXT NOT NULL DEFAULT '[]',
    applied_policy_packs_json TEXT NOT NULL DEFAULT '[]',
    applied_governance_profile TEXT NOT NULL DEFAULT 'default',
    linked_jira_summary_json TEXT NOT NULL DEFAULT '[]',
    acceptance_criteria_summary TEXT NOT NULL DEFAULT '',
    historical_reviewer_signals INTEGER NOT NULL DEFAULT 0,
    context_mode TEXT NOT NULL DEFAULT 'fallback',
    parser_languages_available_json TEXT NOT NULL DEFAULT '[]',
    model_used TEXT NOT NULL DEFAULT '',
    llm_status TEXT NOT NULL DEFAULT 'not_requested',
    stale_reason TEXT,
    blocker_count INTEGER NOT NULL DEFAULT 0,
    important_count INTEGER NOT NULL DEFAULT 0,
    follow_up_count INTEGER NOT NULL DEFAULT 0,
    strict_output_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_readiness_snapshots_pr
    ON pr_readiness_snapshots(provider, project_key, repo_slug, pr_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_readiness_snapshots_commit
    ON pr_readiness_snapshots(provider, project_key, repo_slug, pr_id, latest_commit_sha);

  CREATE TABLE IF NOT EXISTS pr_watch_state (
    provider TEXT NOT NULL DEFAULT 'bitbucket',
    project_key TEXT NOT NULL,
    repo_slug TEXT NOT NULL,
    pr_id INTEGER NOT NULL,
    latest_seen_commit_sha TEXT NOT NULL DEFAULT '',
    latest_jira_fingerprint TEXT NOT NULL DEFAULT '',
    last_snapshot_id TEXT,
    last_refresh_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (provider, project_key, repo_slug, pr_id)
  );
`);

// ─── Prepared Statements ────────────────────────────────────────────────────

const upsertSnapshotStmt = db.prepare(`
  INSERT INTO pr_readiness_snapshots (
    id, provider, project_key, repo_slug, pr_id, pr_title, pr_author,
    latest_commit_sha, diff_fingerprint, jira_fingerprint,
    readiness_state, overall_risk,
    deterministic_findings_json, llm_findings_json, final_merged_findings_json,
    applied_policy_packs_json, applied_governance_profile,
    linked_jira_summary_json, acceptance_criteria_summary,
    historical_reviewer_signals, context_mode, parser_languages_available_json,
    model_used, llm_status, stale_reason,
    blocker_count, important_count, follow_up_count,
    strict_output_json, created_at, updated_at
  ) VALUES (
    @id, @provider, @projectKey, @repoSlug, @prId, @prTitle, @prAuthor,
    @latestCommitSha, @diffFingerprint, @jiraFingerprint,
    @readinessState, @overallRisk,
    @deterministicFindingsJson, @llmFindingsJson, @finalMergedFindingsJson,
    @appliedPolicyPacksJson, @appliedGovernanceProfile,
    @linkedJiraSummaryJson, @acceptanceCriteriaSummary,
    @historicalReviewerSignals, @contextMode, @parserLanguagesAvailableJson,
    @modelUsed, @llmStatus, @staleReason,
    @blockerCount, @importantCount, @followUpCount,
    @strictOutputJson, @createdAt, @updatedAt
  )
  ON CONFLICT(id) DO UPDATE SET
    readiness_state = excluded.readiness_state,
    overall_risk = excluded.overall_risk,
    deterministic_findings_json = excluded.deterministic_findings_json,
    llm_findings_json = excluded.llm_findings_json,
    final_merged_findings_json = excluded.final_merged_findings_json,
    applied_policy_packs_json = excluded.applied_policy_packs_json,
    applied_governance_profile = excluded.applied_governance_profile,
    linked_jira_summary_json = excluded.linked_jira_summary_json,
    acceptance_criteria_summary = excluded.acceptance_criteria_summary,
    historical_reviewer_signals = excluded.historical_reviewer_signals,
    context_mode = excluded.context_mode,
    parser_languages_available_json = excluded.parser_languages_available_json,
    model_used = excluded.model_used,
    llm_status = excluded.llm_status,
    stale_reason = excluded.stale_reason,
    blocker_count = excluded.blocker_count,
    important_count = excluded.important_count,
    follow_up_count = excluded.follow_up_count,
    strict_output_json = excluded.strict_output_json,
    updated_at = excluded.updated_at
`);

const getLatestSnapshotStmt = db.prepare(`
  SELECT * FROM pr_readiness_snapshots
  WHERE provider = ? AND project_key = ? AND repo_slug = ? AND pr_id = ?
  ORDER BY created_at DESC
  LIMIT 1
`);

const getSnapshotByIdStmt = db.prepare(`
  SELECT * FROM pr_readiness_snapshots WHERE id = ?
`);

const getLatestSnapshotsByRepoStmt = db.prepare(`
  SELECT s.* FROM pr_readiness_snapshots s
  INNER JOIN (
    SELECT provider, project_key, repo_slug, pr_id, MAX(created_at) AS max_created
    FROM pr_readiness_snapshots
    WHERE provider = ? AND project_key = ? AND repo_slug = ?
    GROUP BY provider, project_key, repo_slug, pr_id
  ) latest ON s.provider = latest.provider
    AND s.project_key = latest.project_key
    AND s.repo_slug = latest.repo_slug
    AND s.pr_id = latest.pr_id
    AND s.created_at = latest.max_created
`);

const getSnapshotHistoryStmt = db.prepare(`
  SELECT * FROM pr_readiness_snapshots
  WHERE provider = ? AND project_key = ? AND repo_slug = ? AND pr_id = ?
  ORDER BY created_at DESC
  LIMIT ?
`);

const upsertWatchStateStmt = db.prepare(`
  INSERT INTO pr_watch_state
    (provider, project_key, repo_slug, pr_id, latest_seen_commit_sha, latest_jira_fingerprint, last_snapshot_id, last_refresh_at)
  VALUES (@provider, @projectKey, @repoSlug, @prId, @latestSeenCommitSha, @latestJiraFingerprint, @lastSnapshotId, @lastRefreshAt)
  ON CONFLICT(provider, project_key, repo_slug, pr_id) DO UPDATE SET
    latest_seen_commit_sha = excluded.latest_seen_commit_sha,
    latest_jira_fingerprint = excluded.latest_jira_fingerprint,
    last_snapshot_id = excluded.last_snapshot_id,
    last_refresh_at = excluded.last_refresh_at
`);

const getWatchStateStmt = db.prepare(`
  SELECT * FROM pr_watch_state
  WHERE provider = ? AND project_key = ? AND repo_slug = ? AND pr_id = ?
`);

const listWatchedPRsStmt = db.prepare(`
  SELECT * FROM pr_watch_state
  WHERE last_refresh_at > datetime('now', '-' || ? || ' minutes')
  ORDER BY last_refresh_at ASC
`);

const pruneOldSnapshotsStmt = db.prepare(`
  DELETE FROM pr_readiness_snapshots
  WHERE id NOT IN (
    SELECT id FROM pr_readiness_snapshots s2
    WHERE s2.provider = pr_readiness_snapshots.provider
      AND s2.project_key = pr_readiness_snapshots.project_key
      AND s2.repo_slug = pr_readiness_snapshots.repo_slug
      AND s2.pr_id = pr_readiness_snapshots.pr_id
    ORDER BY s2.created_at DESC
    LIMIT ?
  )
  AND created_at < datetime('now', '-' || ? || ' days')
`);

// ─── Public API ─────────────────────────────────────────────────────────────

export function saveSnapshot(snap: PRReadinessSnapshot): void {
  upsertSnapshotStmt.run({
    id: snap.id,
    provider: snap.provider,
    projectKey: snap.projectKey,
    repoSlug: snap.repoSlug,
    prId: snap.prId,
    prTitle: snap.prTitle,
    prAuthor: snap.prAuthor,
    latestCommitSha: snap.latestCommitSha,
    diffFingerprint: snap.diffFingerprint,
    jiraFingerprint: snap.jiraFingerprint,
    readinessState: snap.readinessState,
    overallRisk: snap.overallRisk,
    deterministicFindingsJson: JSON.stringify(snap.deterministicFindings),
    llmFindingsJson: JSON.stringify(snap.llmFindings),
    finalMergedFindingsJson: JSON.stringify(snap.finalMergedFindings),
    appliedPolicyPacksJson: JSON.stringify(snap.appliedPolicyPacks),
    appliedGovernanceProfile: snap.appliedGovernanceProfile,
    linkedJiraSummaryJson: JSON.stringify(snap.linkedJiraSummary),
    acceptanceCriteriaSummary: snap.acceptanceCriteriaSummary,
    historicalReviewerSignals: snap.historicalReviewerSignals,
    contextMode: snap.contextMode,
    parserLanguagesAvailableJson: JSON.stringify(snap.parserLanguagesAvailable),
    modelUsed: snap.modelUsed,
    llmStatus: snap.llmStatus,
    staleReason: snap.staleReason ?? null,
    blockerCount: snap.blockerCount,
    importantCount: snap.importantCount,
    followUpCount: snap.followUpCount,
    strictOutputJson: snap.strictOutput ? JSON.stringify(snap.strictOutput) : null,
    createdAt: snap.createdAt,
    updatedAt: snap.updatedAt,
  });
}

export function getLatestSnapshot(
  provider: string,
  projectKey: string,
  repoSlug: string,
  prId: number,
): PRReadinessSnapshot | null {
  const row = getLatestSnapshotStmt.get(provider, projectKey, repoSlug, prId) as any;
  return row ? rowToSnapshot(row) : null;
}

export function getSnapshotById(id: string): PRReadinessSnapshot | null {
  const row = getSnapshotByIdStmt.get(id) as any;
  return row ? rowToSnapshot(row) : null;
}

export function getLatestSnapshotsByRepo(
  provider: string,
  projectKey: string,
  repoSlug: string,
): PRReadinessSnapshot[] {
  const rows = getLatestSnapshotsByRepoStmt.all(provider, projectKey, repoSlug) as any[];
  return rows.map(rowToSnapshot);
}

export function getSnapshotHistory(
  provider: string,
  projectKey: string,
  repoSlug: string,
  prId: number,
  limit = 10,
): PRReadinessSnapshot[] {
  const rows = getSnapshotHistoryStmt.all(provider, projectKey, repoSlug, prId, limit) as any[];
  return rows.map(rowToSnapshot);
}

export function saveWatchState(ws: PRWatchState): void {
  upsertWatchStateStmt.run({
    provider: ws.provider,
    projectKey: ws.projectKey,
    repoSlug: ws.repoSlug,
    prId: ws.prId,
    latestSeenCommitSha: ws.latestSeenCommitSha,
    latestJiraFingerprint: ws.latestJiraFingerprint,
    lastSnapshotId: ws.lastSnapshotId ?? null,
    lastRefreshAt: ws.lastRefreshAt,
  });
}

export function getWatchState(
  provider: string,
  projectKey: string,
  repoSlug: string,
  prId: number,
): PRWatchState | null {
  const row = getWatchStateStmt.get(provider, projectKey, repoSlug, prId) as any;
  return row ? rowToWatchState(row) : null;
}

export function listWatchedPRs(maxAgeMinutes = 1440): PRWatchState[] {
  const rows = listWatchedPRsStmt.all(maxAgeMinutes) as any[];
  return rows.map(rowToWatchState);
}

export function pruneOldSnapshots(keepPerPR = 5, retentionDays = 90): void {
  pruneOldSnapshotsStmt.run(keepPerPR, retentionDays);
}

// ─── Summary Builder ────────────────────────────────────────────────────────

export function buildSummaryResponse(
  snap: PRReadinessSnapshot,
  staleTtlMinutes: number,
): ReadinessSummaryResponse {
  const updatedAt = new Date(snap.updatedAt);
  const ageMs = Date.now() - updatedAt.getTime();
  const ageMinutes = ageMs / 60_000;
  const isStale = ageMinutes > staleTtlMinutes;
  const staleReason = isStale ? `Snapshot is ${Math.round(ageMinutes)} minutes old (TTL: ${staleTtlMinutes}m)` : snap.staleReason;

  const readinessState: ReadinessState =
    isStale && snap.readinessState !== "error" ? "stale" : snap.readinessState;

  const hours = Math.floor(ageMs / 3_600_000);
  const mins = Math.floor((ageMs % 3_600_000) / 60_000);
  const snapshotAge = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  const summary = buildOneLinerSummary(snap, isStale);

  return {
    readinessState,
    overallRisk: snap.overallRisk,
    blockerCount: snap.blockerCount,
    importantCount: snap.importantCount,
    followUpCount: snap.followUpCount,
    commitShaReviewed: snap.latestCommitSha,
    snapshotAge,
    isStale,
    staleReason,
    llmStatus: snap.llmStatus,
    contextMode: snap.contextMode,
    appliedPolicyPacks: snap.appliedPolicyPacks,
    summary,
    updatedAt: snap.updatedAt,
  };
}

function buildOneLinerSummary(snap: PRReadinessSnapshot, isStale: boolean): string {
  if (isStale) return `Stale snapshot — last reviewed commit ${snap.latestCommitSha.slice(0, 8)}`;
  if (snap.readinessState === "blocked") {
    return `Blocked: ${snap.blockerCount} blocker(s) found`;
  }
  if (snap.readinessState === "ready_with_warnings") {
    return `Ready with warnings: ${snap.importantCount} important, ${snap.followUpCount} follow-up`;
  }
  if (snap.readinessState === "ready") {
    return "Ready to merge — no blockers detected";
  }
  return `State: ${snap.readinessState}, risk: ${snap.overallRisk}`;
}

// ─── Row Mappers ────────────────────────────────────────────────────────────

function rowToSnapshot(row: any): PRReadinessSnapshot {
  return {
    id: row.id,
    provider: row.provider,
    projectKey: row.project_key,
    repoSlug: row.repo_slug,
    prId: row.pr_id,
    prTitle: row.pr_title,
    prAuthor: row.pr_author,
    latestCommitSha: row.latest_commit_sha,
    diffFingerprint: row.diff_fingerprint,
    jiraFingerprint: row.jira_fingerprint,
    readinessState: row.readiness_state,
    overallRisk: row.overall_risk,
    deterministicFindings: safeJsonParse(row.deterministic_findings_json, []),
    llmFindings: safeJsonParse(row.llm_findings_json, []),
    finalMergedFindings: safeJsonParse(row.final_merged_findings_json, []),
    appliedPolicyPacks: safeJsonParse(row.applied_policy_packs_json, []),
    appliedGovernanceProfile: row.applied_governance_profile,
    linkedJiraSummary: safeJsonParse(row.linked_jira_summary_json, []),
    acceptanceCriteriaSummary: row.acceptance_criteria_summary,
    historicalReviewerSignals: row.historical_reviewer_signals,
    contextMode: row.context_mode,
    parserLanguagesAvailable: safeJsonParse(row.parser_languages_available_json, []),
    modelUsed: row.model_used,
    llmStatus: row.llm_status,
    staleReason: row.stale_reason ?? undefined,
    blockerCount: row.blocker_count,
    importantCount: row.important_count,
    followUpCount: row.follow_up_count,
    strictOutput: row.strict_output_json ? safeJsonParse(row.strict_output_json, undefined) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToWatchState(row: any): PRWatchState {
  return {
    provider: row.provider,
    projectKey: row.project_key,
    repoSlug: row.repo_slug,
    prId: row.pr_id,
    latestSeenCommitSha: row.latest_seen_commit_sha,
    latestJiraFingerprint: row.latest_jira_fingerprint,
    lastSnapshotId: row.last_snapshot_id ?? undefined,
    lastRefreshAt: row.last_refresh_at,
  };
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
