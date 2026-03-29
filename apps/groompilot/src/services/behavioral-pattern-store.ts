import { v4 as uuidv4 } from "uuid";
import db from "../db";

export interface DbPRSignal {
  id: number;
  repoSlug: string;
  prId: number;
  prTitle: string;
  author: string;
  mergedAt: string;
  approvalCount: number;
  needsWorkCount: number;
  commentCount: number;
  blockerCount: number;
  additions: number;
  deletions: number;
  changedFiles: number;
  topPaths: string[];
  commentSamples: string[];
  fetchedAt: string;
}

export interface DbPattern {
  id: number;
  repoSlug: string;
  patternName: string;
  guidance: string;
  appliesTo: string[];
  severitySignal: string;
  source: string;
  batchRunId: string | null;
  confidence: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DbBatchRun {
  id: string;
  repoSlug: string;
  status: "running" | "completed" | "failed";
  signalsFetched: number;
  patternsDerived: number;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface UpsertSignalInput {
  prId: number;
  prTitle: string;
  author: string;
  mergedAt: string;
  approvalCount: number;
  needsWorkCount: number;
  commentCount: number;
  blockerCount: number;
  additions: number;
  deletions: number;
  changedFiles: number;
  topPaths: string[];
  commentSamples: string[];
}

interface UpsertPatternInput {
  patternName: string;
  guidance: string;
  appliesTo: string[];
  severitySignal: string;
  confidence: number;
}

function mapPatternRow(row: any): DbPattern {
  return {
    id: row.id,
    repoSlug: row.repo_slug,
    patternName: row.pattern_name,
    guidance: row.guidance,
    appliesTo: JSON.parse(row.applies_to || "[]"),
    severitySignal: row.severity_signal,
    source: row.source,
    batchRunId: row.batch_run_id,
    confidence: Number(row.confidence || 0),
    enabled: Number(row.enabled || 0) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function upsertSignals(repoSlug: string, signals: UpsertSignalInput[]): void {
  if (signals.length === 0) return;

  const stmt = db.prepare(`
    INSERT INTO bpe_pr_signals
      (repo_slug, pr_id, pr_title, author, merged_at, approval_count, needs_work_count,
       comment_count, blocker_count, additions, deletions, changed_files, top_paths, comment_samples)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(repo_slug, pr_id) DO UPDATE SET
      pr_title = excluded.pr_title,
      approval_count = excluded.approval_count,
      needs_work_count = excluded.needs_work_count,
      comment_count = excluded.comment_count,
      blocker_count = excluded.blocker_count,
      additions = excluded.additions,
      deletions = excluded.deletions,
      changed_files = excluded.changed_files,
      top_paths = excluded.top_paths,
      comment_samples = excluded.comment_samples,
      merged_at = excluded.merged_at,
      fetched_at = datetime('now')
  `);

  const tx = db.transaction((rows: UpsertSignalInput[]) => {
    for (const s of rows) {
      stmt.run(
        repoSlug,
        s.prId,
        s.prTitle,
        s.author,
        s.mergedAt,
        s.approvalCount,
        s.needsWorkCount,
        s.commentCount,
        s.blockerCount,
        s.additions,
        s.deletions,
        s.changedFiles,
        JSON.stringify(s.topPaths || []),
        JSON.stringify(s.commentSamples || []),
      );
    }
  });

  tx(signals);
}

export function getCachedSignals(repoSlug: string, windowDays = 90, limit = 400): DbPRSignal[] {
  const rows = db.prepare(`
    SELECT *
    FROM bpe_pr_signals
    WHERE repo_slug = ?
      AND merged_at >= datetime('now', '-' || ? || ' days')
    ORDER BY merged_at DESC
    LIMIT ?
  `).all(repoSlug, Math.max(1, windowDays), Math.max(1, limit)) as any[];

  return rows.map((row) => ({
    id: row.id,
    repoSlug: row.repo_slug,
    prId: row.pr_id,
    prTitle: row.pr_title,
    author: row.author,
    mergedAt: row.merged_at,
    approvalCount: Number(row.approval_count || 0),
    needsWorkCount: Number(row.needs_work_count || 0),
    commentCount: Number(row.comment_count || 0),
    blockerCount: Number(row.blocker_count || 0),
    additions: Number(row.additions || 0),
    deletions: Number(row.deletions || 0),
    changedFiles: Number(row.changed_files || 0),
    topPaths: JSON.parse(row.top_paths || "[]"),
    commentSamples: JSON.parse(row.comment_samples || "[]"),
    fetchedAt: row.fetched_at,
  }));
}

export function getLatestKnownPrId(repoSlug: string): number | null {
  const row = db.prepare(`
    SELECT pr_id
    FROM bpe_pr_signals
    WHERE repo_slug = ?
    ORDER BY pr_id DESC
    LIMIT 1
  `).get(repoSlug) as { pr_id: number } | undefined;

  return row?.pr_id ?? null;
}

export function getSignalCount(repoSlug: string): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM bpe_pr_signals WHERE repo_slug = ?").get(repoSlug) as { count: number };
  return Number(row?.count || 0);
}

export function upsertDerivedPatterns(repoSlug: string, patterns: UpsertPatternInput[], batchRunId: string): void {
  db.prepare("UPDATE bpe_patterns SET enabled = 0, updated_at = datetime('now') WHERE repo_slug = ? AND source = 'ai-batch'").run(repoSlug);

  if (patterns.length === 0) return;

  const stmt = db.prepare(`
    INSERT INTO bpe_patterns
      (repo_slug, pattern_name, guidance, applies_to, severity_signal, source, batch_run_id, confidence, enabled)
    VALUES (?, ?, ?, ?, ?, 'ai-batch', ?, ?, 1)
  `);

  const tx = db.transaction((rows: UpsertPatternInput[]) => {
    for (const p of rows) {
      stmt.run(
        repoSlug,
        p.patternName,
        p.guidance,
        JSON.stringify(p.appliesTo || []),
        p.severitySignal,
        batchRunId,
        p.confidence,
      );
    }
  });

  tx(patterns);
}

export function getEnabledPatterns(repoSlug: string): Array<{
  source: string;
  title: string;
  guidance: string;
  appliesTo: string[];
}> {
  const rows = db.prepare(`
    SELECT *
    FROM bpe_patterns
    WHERE repo_slug = ? AND enabled = 1
    ORDER BY confidence DESC, created_at DESC
  `).all(repoSlug) as any[];

  return rows.map((row) => ({
    source: `behavioral-${row.source}`,
    title: row.pattern_name,
    guidance: row.guidance,
    appliesTo: JSON.parse(row.applies_to || "[]"),
  }));
}

export function getAllPatterns(repoSlug: string): DbPattern[] {
  const rows = db.prepare(`
    SELECT *
    FROM bpe_patterns
    WHERE repo_slug = ?
    ORDER BY enabled DESC, confidence DESC, updated_at DESC
  `).all(repoSlug) as any[];

  return rows.map(mapPatternRow);
}

export function addManualPattern(
  repoSlug: string,
  pattern: { patternName: string; guidance: string; appliesTo: string[]; severitySignal: string },
): DbPattern {
  const result = db.prepare(`
    INSERT INTO bpe_patterns
      (repo_slug, pattern_name, guidance, applies_to, severity_signal, source, confidence, enabled)
    VALUES (?, ?, ?, ?, ?, 'manual', 1.0, 1)
  `).run(
    repoSlug,
    pattern.patternName,
    pattern.guidance,
    JSON.stringify(pattern.appliesTo || []),
    pattern.severitySignal,
  );

  const created = db.prepare("SELECT * FROM bpe_patterns WHERE id = ?").get(result.lastInsertRowid);
  return mapPatternRow(created);
}

export function updatePattern(
  id: number,
  updates: Partial<{
    patternName: string;
    guidance: string;
    appliesTo: string[];
    severitySignal: string;
    confidence: number;
    enabled: boolean;
  }>,
): DbPattern | null {
  const setClauses: string[] = [];
  const values: any[] = [];

  if (updates.patternName !== undefined) {
    setClauses.push("pattern_name = ?");
    values.push(updates.patternName);
  }
  if (updates.guidance !== undefined) {
    setClauses.push("guidance = ?");
    values.push(updates.guidance);
  }
  if (updates.appliesTo !== undefined) {
    setClauses.push("applies_to = ?");
    values.push(JSON.stringify(updates.appliesTo));
  }
  if (updates.severitySignal !== undefined) {
    setClauses.push("severity_signal = ?");
    values.push(updates.severitySignal);
  }
  if (updates.confidence !== undefined) {
    setClauses.push("confidence = ?");
    values.push(updates.confidence);
  }
  if (updates.enabled !== undefined) {
    setClauses.push("enabled = ?");
    values.push(updates.enabled ? 1 : 0);
  }

  if (setClauses.length === 0) {
    const existing = db.prepare("SELECT * FROM bpe_patterns WHERE id = ?").get(id);
    return existing ? mapPatternRow(existing) : null;
  }

  setClauses.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE bpe_patterns SET ${setClauses.join(", ")} WHERE id = ?`).run(...values);

  const updated = db.prepare("SELECT * FROM bpe_patterns WHERE id = ?").get(id);
  return updated ? mapPatternRow(updated) : null;
}

export function deletePattern(id: number): boolean {
  return db.prepare("DELETE FROM bpe_patterns WHERE id = ?").run(id).changes > 0;
}

function mapBatchRunRow(row: any): DbBatchRun {
  return {
    id: row.id,
    repoSlug: row.repo_slug,
    status: row.status,
    signalsFetched: Number(row.signals_fetched || 0),
    patternsDerived: Number(row.patterns_derived || 0),
    error: row.error || null,
    startedAt: row.started_at,
    completedAt: row.completed_at || null,
  };
}

export function startBatchRun(repoSlug: string): string {
  const id = uuidv4();
  db.prepare("INSERT INTO bpe_batch_runs (id, repo_slug, status) VALUES (?, ?, 'running')").run(id, repoSlug);
  return id;
}

export function completeBatchRun(id: string, signalsFetched: number, patternsDerived: number): void {
  db.prepare(`
    UPDATE bpe_batch_runs
    SET status = 'completed', signals_fetched = ?, patterns_derived = ?, completed_at = datetime('now')
    WHERE id = ?
  `).run(signalsFetched, patternsDerived, id);
}

export function failBatchRun(id: string, error: string): void {
  db.prepare(`
    UPDATE bpe_batch_runs
    SET status = 'failed', error = ?, completed_at = datetime('now')
    WHERE id = ?
  `).run(error.slice(0, 2000), id);
}

export function isBatchRunning(repoSlug: string): boolean {
  const row = db.prepare(`
    SELECT id
    FROM bpe_batch_runs
    WHERE repo_slug = ?
      AND status = 'running'
      AND started_at >= datetime('now', '-2 hours')
    LIMIT 1
  `).get(repoSlug);

  return !!row;
}

export function getLastBatchRun(repoSlug: string): DbBatchRun | null {
  const row = db.prepare(`
    SELECT *
    FROM bpe_batch_runs
    WHERE repo_slug = ?
    ORDER BY started_at DESC
    LIMIT 1
  `).get(repoSlug);

  return row ? mapBatchRunRow(row) : null;
}

export function getBatchRunHistory(repoSlug: string, limit = 20): DbBatchRun[] {
  const rows = db.prepare(`
    SELECT *
    FROM bpe_batch_runs
    WHERE repo_slug = ?
    ORDER BY started_at DESC
    LIMIT ?
  `).all(repoSlug, Math.max(1, limit)) as any[];

  return rows.map(mapBatchRunRow);
}
