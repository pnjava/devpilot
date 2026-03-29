import db from "../db";
import type { Finding } from "./pr-review";

export const SUPPRESSION_REASON_CODES = [
  "false_positive",
  "accepted_risk",
  "duplicate",
  "legacy_debt",
  "out_of_scope",
] as const;

export type SuppressionReasonCode = typeof SUPPRESSION_REASON_CODES[number];

export interface ReviewSuppression {
  id: number;
  repoSlug: string;
  fingerprint: string;
  reasonCode: SuppressionReasonCode;
  reasonDetail?: string;
  owner: string;
  createdBy?: string;
  expiresAt: string;
  status: "active" | "expired";
  createdAt: string;
  updatedAt: string;
  lastAppliedAt?: string;
  appliedCount: number;
}

export interface SuppressedFindingRecord {
  findingId: string;
  file: string;
  title: string;
  fingerprint: string;
  reasonCode: SuppressionReasonCode;
  owner: string;
  expiresAt: string;
  suppressionId: number;
}

const DEFAULT_SUPPRESSION_TTL_DAYS = 30;
const MAX_SUPPRESSION_TTL_DAYS = Number(process.env.SUPPRESSION_MAX_TTL_DAYS || 180);

export function computeSuppressionWeight(suppression: Pick<ReviewSuppression, "repoSlug" | "expiresAt" | "appliedCount">): number {
  const ttlDays = Math.max(0, (new Date(suppression.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const repoBoost = suppression.repoSlug === "*" ? 0.9 : 1.1;
  const reuseBoost = Math.min(0.35, Math.log10((suppression.appliedCount || 0) + 1) / 3);
  const freshnessBoost = Math.min(0.25, ttlDays / 180);
  return Number((repoBoost + reuseBoost + freshnessBoost).toFixed(4));
}

function looksGenerated(file: string): boolean {
  const normalized = file.toLowerCase();
  return /(^|\/)(dist|build|generated|gen)\//.test(normalized)
    || /(_pb2\.py|\.pb\.java|\.g\.java|\.generated\.(ts|js|java|py)|\.map|\.min\.js)$/.test(normalized);
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function computeFindingFingerprint(finding: Pick<Finding, "file" | "title" | "category" | "dimension" | "line">): string {
  const file = normalizeToken(String(finding.file || "unknown"));
  const title = normalizeToken(String(finding.title || "finding"));
  const category = normalizeToken(String(finding.category || "general"));
  const dimension = normalizeToken(String(finding.dimension || "correctness"));
  const lineBucket = typeof finding.line === "number" && Number.isFinite(finding.line)
    ? String(Math.floor(Math.max(1, finding.line) / 5) * 5)
    : "na";

  return `${file}|${dimension}|${category}|${title}|${lineBucket}`;
}

function toIso(input?: string): string {
  if (!input) {
    return new Date(Date.now() + DEFAULT_SUPPRESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("expiresAt must be a valid ISO date");
  }
  return parsed.toISOString();
}

function validateExpiry(expiresAtIso: string): void {
  const now = Date.now();
  const expiry = new Date(expiresAtIso).getTime();

  if (expiry <= now) {
    throw new Error("expiresAt must be in the future");
  }

  const maxExpiry = now + MAX_SUPPRESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
  if (expiry > maxExpiry) {
    throw new Error(`expiresAt exceeds max TTL of ${MAX_SUPPRESSION_TTL_DAYS} days`);
  }
}

function recordEvent(suppressionId: number, eventType: string, actor: string, notes?: string): void {
  db.prepare(`
    INSERT INTO review_suppression_events (suppression_id, event_type, actor, notes)
    VALUES (?, ?, ?, ?)
  `).run(suppressionId, eventType, actor, notes || null);
}

function rowToSuppression(row: any): ReviewSuppression {
  return {
    id: Number(row.id),
    repoSlug: String(row.repo_slug),
    fingerprint: String(row.fingerprint),
    reasonCode: row.reason_code as SuppressionReasonCode,
    reasonDetail: row.reason_detail ? String(row.reason_detail) : undefined,
    owner: String(row.owner),
    createdBy: row.created_by ? String(row.created_by) : undefined,
    expiresAt: String(row.expires_at),
    status: String(row.status) === "expired" ? "expired" : "active",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastAppliedAt: row.last_applied_at ? String(row.last_applied_at) : undefined,
    appliedCount: Number(row.applied_count || 0),
  };
}

export function listSuppressions(repoSlug: string, includeInactive = false): ReviewSuppression[] {
  const rows = includeInactive
    ? db.prepare(`
      SELECT * FROM review_suppressions
      WHERE repo_slug = ?
      ORDER BY updated_at DESC
    `).all(repoSlug)
    : db.prepare(`
      SELECT * FROM review_suppressions
      WHERE repo_slug = ?
        AND status = 'active'
      ORDER BY updated_at DESC
    `).all(repoSlug);

  return rows.map(rowToSuppression);
}

export function createSuppression(params: {
  repoSlug: string;
  fingerprint?: string;
  finding?: Pick<Finding, "file" | "title" | "category" | "dimension" | "line">;
  reasonCode: SuppressionReasonCode;
  reasonDetail?: string;
  owner: string;
  actor: string;
  expiresAt?: string;
}): ReviewSuppression {
  if (!SUPPRESSION_REASON_CODES.includes(params.reasonCode)) {
    throw new Error(`reasonCode must be one of: ${SUPPRESSION_REASON_CODES.join(", ")}`);
  }

  const fingerprint = params.fingerprint
    ? normalizeToken(params.fingerprint)
    : params.finding
      ? computeFindingFingerprint(params.finding)
      : "";

  if (!fingerprint) {
    throw new Error("fingerprint or finding is required");
  }

  const expiresAtIso = toIso(params.expiresAt);
  validateExpiry(expiresAtIso);

  db.prepare(`
    INSERT INTO review_suppressions (
      repo_slug, fingerprint, reason_code, reason_detail, owner, created_by, expires_at, status, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))
    ON CONFLICT(repo_slug, fingerprint, status)
    DO UPDATE SET
      reason_code = excluded.reason_code,
      reason_detail = excluded.reason_detail,
      owner = excluded.owner,
      created_by = excluded.created_by,
      expires_at = excluded.expires_at,
      updated_at = datetime('now')
  `).run(
    params.repoSlug,
    fingerprint,
    params.reasonCode,
    params.reasonDetail || null,
    params.owner,
    params.actor,
    expiresAtIso,
  );

  const row = db.prepare(`
    SELECT * FROM review_suppressions
    WHERE repo_slug = ? AND fingerprint = ? AND status = 'active'
    LIMIT 1
  `).get(params.repoSlug, fingerprint) as Record<string, unknown> | undefined;

  if (!row) {
    throw new Error("Failed to create suppression");
  }

  recordEvent(Number(row.id), "upserted", params.actor, params.reasonDetail);
  return rowToSuppression(row);
}

export function expireSuppression(params: {
  id: number;
  actor: string;
  notes?: string;
}): boolean {
  const row = db.prepare(`SELECT id FROM review_suppressions WHERE id = ? AND status = 'active'`).get(params.id) as { id: number } | undefined;
  if (!row) return false;

  db.prepare(`
    UPDATE review_suppressions
    SET status = 'expired', updated_at = datetime('now')
    WHERE id = ?
  `).run(params.id);

  recordEvent(params.id, "expired", params.actor, params.notes);
  return true;
}

function getActiveSuppressions(repoSlug: string): ReviewSuppression[] {
  const nowIso = new Date().toISOString();
  const rows = db.prepare(`
    SELECT * FROM review_suppressions
    WHERE status = 'active'
      AND datetime(expires_at) > datetime(?)
      AND (repo_slug = ? OR repo_slug = '*')
  `).all(nowIso, repoSlug);

  return rows.map(rowToSuppression);
}

export function applyActiveSuppressions(repoSlug: string | undefined, findings: Finding[]): {
  findings: Finding[];
  suppressed: SuppressedFindingRecord[];
} {
  const repo = (repoSlug || "*").trim() || "*";
  const active = getActiveSuppressions(repo);
  if (active.length === 0 || findings.length === 0) {
    return { findings, suppressed: [] };
  }

  const byFingerprint = new Map<string, ReviewSuppression>();
  for (const suppression of active) {
    const existing = byFingerprint.get(suppression.fingerprint);
    if (!existing) {
      byFingerprint.set(suppression.fingerprint, suppression);
      continue;
    }

    if (computeSuppressionWeight(suppression) > computeSuppressionWeight(existing)) {
      byFingerprint.set(suppression.fingerprint, suppression);
    }
  }

  const suppressed: SuppressedFindingRecord[] = [];
  const kept: Finding[] = [];
  const appliedCounts = new Map<number, number>();
  let autoSuppressedCount = 0;

  for (const finding of findings) {
    const fingerprint = computeFindingFingerprint(finding);
    const match = byFingerprint.get(fingerprint);
    const generatedLowSignal = looksGenerated(finding.file)
      && finding.severity !== "critical"
      && finding.dimension !== "security"
      && finding.action !== "block";
    if (generatedLowSignal) {
      const autoTtlDays = Math.min(90, MAX_SUPPRESSION_TTL_DAYS);
      const autoExpiresAt = new Date(Date.now() + autoTtlDays * 24 * 60 * 60 * 1000).toISOString();
      suppressed.push({
        findingId: finding.id,
        file: finding.file,
        title: finding.title,
        fingerprint,
        reasonCode: "out_of_scope",
        owner: "system-generated",
        expiresAt: autoExpiresAt,
        suppressionId: -1,
      });
      autoSuppressedCount += 1;
      continue;
    }
    if (!match) {
      kept.push(finding);
      continue;
    }

    suppressed.push({
      findingId: finding.id,
      file: finding.file,
      title: finding.title,
      fingerprint,
      reasonCode: match.reasonCode,
      owner: match.owner,
      expiresAt: match.expiresAt,
      suppressionId: match.id,
    });

    appliedCounts.set(match.id, (appliedCounts.get(match.id) || 0) + 1);
  }

  for (const [suppressionId, applied] of appliedCounts.entries()) {
    db.prepare(`
      UPDATE review_suppressions
      SET applied_count = applied_count + ?,
          last_applied_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(applied, suppressionId);

    recordEvent(suppressionId, "applied", "system", `suppressed ${applied} finding(s)`);
  }

  if (autoSuppressedCount > 0) {
    console.info(`[suppression] auto-suppressed ${autoSuppressedCount} generated-file finding(s) for repo=${repo}`);
  }

  return { findings: kept, suppressed };
}
