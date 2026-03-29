/**
 * SQLite-backed in-process job queue for PR Readiness pipeline.
 *
 * Idempotent by (provider, project_key, repo_slug, pr_id, commit_sha, jira_fingerprint).
 * Supports deduplication, coalescing, bounded retries, priority ordering.
 */

import crypto from "node:crypto";
import db from "../../db";
import type {
  PRReadinessJob,
  PRReadinessRequest,
  ReadinessJobStatus,
} from "./types";

// ─── Table ──────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS pr_readiness_jobs (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL DEFAULT 'bitbucket',
    project_key TEXT NOT NULL,
    repo_slug TEXT NOT NULL,
    pr_id INTEGER NOT NULL,
    commit_sha TEXT NOT NULL,
    jira_fingerprint TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'queued',
    priority INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    scheduled_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    finished_at TEXT,
    error TEXT,
    request_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS idx_readiness_jobs_status_priority
    ON pr_readiness_jobs(status, priority DESC, scheduled_at ASC);
  CREATE INDEX IF NOT EXISTS idx_readiness_jobs_pr
    ON pr_readiness_jobs(provider, project_key, repo_slug, pr_id, status);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_readiness_jobs_dedup
    ON pr_readiness_jobs(provider, project_key, repo_slug, pr_id, commit_sha, jira_fingerprint)
    WHERE status IN ('queued', 'running');
`);

// ─── Prepared Statements ────────────────────────────────────────────────────

const enqueueStmt = db.prepare(`
  INSERT INTO pr_readiness_jobs
    (id, provider, project_key, repo_slug, pr_id, commit_sha, jira_fingerprint,
     reason, status, priority, attempts, max_attempts, scheduled_at, request_json)
  VALUES (@id, @provider, @projectKey, @repoSlug, @prId, @commitSha, @jiraFingerprint,
          @reason, 'queued', @priority, 0, @maxAttempts, datetime('now'), @requestJson)
`);

const supersedePriorStmt = db.prepare(`
  UPDATE pr_readiness_jobs
  SET status = 'superseded', finished_at = datetime('now')
  WHERE provider = @provider
    AND project_key = @projectKey
    AND repo_slug = @repoSlug
    AND pr_id = @prId
    AND status = 'queued'
    AND id != @excludeId
`);

const claimNextStmt = db.prepare(`
  UPDATE pr_readiness_jobs
  SET status = 'running', started_at = datetime('now'), attempts = attempts + 1
  WHERE id = (
    SELECT id FROM pr_readiness_jobs
    WHERE status = 'queued' AND scheduled_at <= datetime('now')
    ORDER BY priority DESC, scheduled_at ASC
    LIMIT 1
  )
  RETURNING *
`);

const completeJobStmt = db.prepare(`
  UPDATE pr_readiness_jobs
  SET status = 'completed', finished_at = datetime('now'), error = NULL
  WHERE id = ?
`);

const failJobStmt = db.prepare(`
  UPDATE pr_readiness_jobs
  SET status = CASE
    WHEN attempts >= max_attempts THEN 'failed'
    ELSE 'queued'
  END,
  finished_at = CASE
    WHEN attempts >= max_attempts THEN datetime('now')
    ELSE NULL
  END,
  error = ?
  WHERE id = ?
`);

const failJobFinalStmt = db.prepare(`
  UPDATE pr_readiness_jobs
  SET status = 'failed', finished_at = datetime('now'), error = ?
  WHERE id = ?
`);

const cancelJobStmt = db.prepare(`
  UPDATE pr_readiness_jobs
  SET status = 'cancelled', finished_at = datetime('now')
  WHERE id = ? AND status IN ('queued', 'running')
`);

const getJobStmt = db.prepare(`
  SELECT * FROM pr_readiness_jobs WHERE id = ?
`);

const getJobsForPRStmt = db.prepare(`
  SELECT * FROM pr_readiness_jobs
  WHERE provider = ? AND project_key = ? AND repo_slug = ? AND pr_id = ?
  ORDER BY scheduled_at DESC LIMIT ?
`);

const queueDepthStmt = db.prepare(`
  SELECT COUNT(*) AS count FROM pr_readiness_jobs WHERE status = 'queued'
`);

const runningCountStmt = db.prepare(`
  SELECT COUNT(*) AS count FROM pr_readiness_jobs WHERE status = 'running'
`);

const pruneOldJobsStmt = db.prepare(`
  DELETE FROM pr_readiness_jobs
  WHERE status IN ('completed', 'failed', 'superseded', 'cancelled')
    AND finished_at < datetime('now', '-' || ? || ' days')
`);

// ─── Public API ─────────────────────────────────────────────────────────────

export function enqueueReadinessJob(
  req: PRReadinessRequest,
  opts?: { priority?: number; maxAttempts?: number },
): { jobId: string; enqueued: boolean; superseded: number } {
  const jiraFingerprint = req.linkedJiraKeys.slice().sort().join(",");
  const jobId = crypto.randomUUID();
  const priority = opts?.priority ?? 0;
  const maxAttempts = opts?.maxAttempts ?? 3;

  const insertTx = db.transaction(() => {
    try {
      enqueueStmt.run({
        id: jobId,
        provider: req.provider,
        projectKey: req.projectKey,
        repoSlug: req.repoSlug,
        prId: req.prId,
        commitSha: req.latestCommitSha,
        jiraFingerprint,
        reason: req.reasonForEvaluation,
        priority,
        maxAttempts,
        requestJson: JSON.stringify(req),
      });
    } catch (err: any) {
      // UNIQUE constraint violation → duplicate, no-op
      if (err?.code === "SQLITE_CONSTRAINT_UNIQUE" || /UNIQUE constraint/i.test(String(err?.message))) {
        return { jobId: "", enqueued: false, superseded: 0 };
      }
      throw err;
    }

    // Supersede older queued jobs for the same PR
    const info = supersedePriorStmt.run({
      provider: req.provider,
      projectKey: req.projectKey,
      repoSlug: req.repoSlug,
      prId: req.prId,
      excludeId: jobId,
    });

    return { jobId, enqueued: true, superseded: info.changes };
  });

  return insertTx();
}

export function claimNextJob(): PRReadinessJob | null {
  const row = claimNextStmt.get() as any;
  if (!row) return null;
  return rowToJob(row);
}

export function completeJob(jobId: string): void {
  completeJobStmt.run(jobId);
}

export function failJob(jobId: string, error: string, opts?: { final?: boolean }): void {
  if (opts?.final) {
    failJobFinalStmt.run(error.slice(0, 2048), jobId);
  } else {
    failJobStmt.run(error.slice(0, 2048), jobId);
  }
}

export function cancelJob(jobId: string): void {
  cancelJobStmt.run(jobId);
}

export function getJob(jobId: string): PRReadinessJob | null {
  const row = getJobStmt.get(jobId) as any;
  return row ? rowToJob(row) : null;
}

export function getJobsForPR(
  provider: string,
  projectKey: string,
  repoSlug: string,
  prId: number,
  limit = 10,
): PRReadinessJob[] {
  const rows = getJobsForPRStmt.all(provider, projectKey, repoSlug, prId, limit) as any[];
  return rows.map(rowToJob);
}

export function queueDepth(): number {
  return (queueDepthStmt.get() as any).count;
}

export function runningCount(): number {
  return (runningCountStmt.get() as any).count;
}

export function pruneOldJobs(retentionDays = 30): void {
  pruneOldJobsStmt.run(retentionDays);
}

// ─── Worker ─────────────────────────────────────────────────────────────────

type JobHandler = (
  job: PRReadinessJob,
  request: PRReadinessRequest,
) => Promise<void>;

let workerRunning = false;
let workerAbort: AbortController | null = null;

export function startReadinessWorker(
  handler: JobHandler,
  opts?: { concurrency?: number; pollIntervalMs?: number },
): void {
  if (workerRunning) return;
  workerRunning = true;
  workerAbort = new AbortController();
  const concurrency = opts?.concurrency ?? 2;
  const pollMs = opts?.pollIntervalMs ?? 3000;

  const run = async () => {
    let active = 0;
    while (!workerAbort?.signal.aborted) {
      if (active >= concurrency) {
        await sleep(pollMs);
        continue;
      }

      const job = claimNextJob();
      if (!job) {
        await sleep(pollMs);
        continue;
      }

      active++;
      processJob(job, handler)
        .finally(() => { active--; });
    }
    workerRunning = false;
  };

  run().catch((err) => {
    console.error("[readiness-worker] fatal error:", err);
    workerRunning = false;
  });
}

export function stopReadinessWorker(): void {
  workerAbort?.abort();
}

async function processJob(
  job: PRReadinessJob,
  handler: JobHandler,
): Promise<void> {
  let request: PRReadinessRequest;
  try {
    request = JSON.parse(job.requestJson);
  } catch {
    failJob(job.id, "Invalid request JSON");
    return;
  }

  try {
    await handler(job, request);
    completeJob(job.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Non-retryable: 404 means the repo/PR no longer exists
    const isNonRetryable = message.includes("404") || message.includes("does not exist");
    if (isNonRetryable) {
      console.warn(`[readiness-worker] job ${job.id} permanently failed (non-retryable): ${message}`);
      failJob(job.id, message, { final: true });
    } else {
      console.error(`[readiness-worker] job ${job.id} failed:`, message);
      failJob(job.id, message);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Row Mapper ─────────────────────────────────────────────────────────────

function rowToJob(row: any): PRReadinessJob {
  return {
    id: row.id,
    provider: row.provider,
    projectKey: row.project_key,
    repoSlug: row.repo_slug,
    prId: row.pr_id,
    commitSha: row.commit_sha,
    jiraFingerprint: row.jira_fingerprint,
    reason: row.reason,
    status: row.status as ReadinessJobStatus,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    error: row.error ?? undefined,
    requestJson: row.request_json,
  };
}
