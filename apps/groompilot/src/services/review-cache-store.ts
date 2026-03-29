import db from "../db";

interface CachedReviewRow {
  review_json: string;
  pr_meta_json: string;
  review_run_id: string | null;
  source_commit: string | null;
  pr_updated_at: number | null;
  updated_at: string;
}

export interface CachedReview {
  review: unknown;
  prMeta: unknown;
  reviewRunId?: string;
  sourceCommit?: string;
  prUpdatedAt?: number;
  updatedAt: string;
}

const getStmt = db.prepare(
  `SELECT review_json, pr_meta_json, review_run_id, source_commit, pr_updated_at, updated_at
   FROM pr_review_cache WHERE pr_url = ?`
);

const upsertStmt = db.prepare(
  `INSERT INTO pr_review_cache (pr_url, review_json, pr_meta_json, review_run_id, source_commit, pr_updated_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
   ON CONFLICT(pr_url) DO UPDATE SET
     review_json = excluded.review_json,
     pr_meta_json = excluded.pr_meta_json,
     review_run_id = excluded.review_run_id,
     source_commit = excluded.source_commit,
     pr_updated_at = excluded.pr_updated_at,
     updated_at = datetime('now')`
);

export function getCachedReview(prUrl: string): CachedReview | null {
  const row = getStmt.get(prUrl) as CachedReviewRow | undefined;
  if (!row) return null;
  try {
    return {
      review: JSON.parse(row.review_json),
      prMeta: JSON.parse(row.pr_meta_json),
      reviewRunId: row.review_run_id ?? undefined,
      sourceCommit: row.source_commit ?? undefined,
      prUpdatedAt: row.pr_updated_at ?? undefined,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

export function setCachedReview(
  prUrl: string,
  review: unknown,
  prMeta: unknown,
  reviewRunId?: string,
  sourceCommit?: string,
  prUpdatedAt?: number,
): void {
  upsertStmt.run(
    prUrl,
    JSON.stringify(review),
    JSON.stringify(prMeta),
    reviewRunId ?? null,
    sourceCommit ?? null,
    prUpdatedAt ?? null,
  );
}
