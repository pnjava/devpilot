/**
 * Webhook Security — HMAC verification, replay protection, rate limiting.
 *
 * Bitbucket Server sends an HMAC-SHA256 signature in the X-Hub-Signature header:
 *   `sha256=<hex-digest>`
 * Header name can be overridden via WEBHOOK_SIGNATURE_HEADER env var.
 */

import crypto from "node:crypto";
import db from "../../db";
import { loadReadinessConfig, type ReadinessConfig } from "./types";

// ─── HMAC Verification ──────────────────────────────────────────────────────

export function verifyHmac(
  secret: string,
  rawBody: Buffer | string,
  signatureHeader: string,
): boolean {
  if (!secret || !signatureHeader) return false;

  // Expected format: "sha256=<hex>"
  const parts = signatureHeader.split("=");
  if (parts.length !== 2) return false;
  const [algo, theirHex] = parts;
  if (algo !== "sha256") return false;

  const ourHex = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  // Timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(ourHex, "hex"),
      Buffer.from(theirHex, "hex"),
    );
  } catch {
    return false;
  }
}

// ─── Header-Token Verification ──────────────────────────────────────────────

export function verifyHeaderToken(
  secret: string,
  tokenHeader: string,
): boolean {
  if (!secret || !tokenHeader) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(secret),
      Buffer.from(tokenHeader),
    );
  } catch {
    return false;
  }
}

// ─── Replay Protection ─────────────────────────────────────────────────────

const ensureTableStmt = db.prepare(`
  CREATE TABLE IF NOT EXISTS webhook_deliveries (
    delivery_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL DEFAULT 'bitbucket',
    event_type TEXT NOT NULL,
    project_key TEXT NOT NULL,
    repo_slug TEXT NOT NULL,
    pr_id INTEGER NOT NULL,
    payload_hash TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT (datetime('now')),
    verified INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'accepted',
    error TEXT
  )
`);
ensureTableStmt.run();

const insertDeliveryStmt = db.prepare(`
  INSERT OR IGNORE INTO webhook_deliveries
    (delivery_id, provider, event_type, project_key, repo_slug, pr_id, payload_hash, received_at, verified, status, error)
  VALUES (@deliveryId, @provider, @eventType, @projectKey, @repoSlug, @prId, @payloadHash, @receivedAt, @verified, @status, @error)
`);

const checkDeliveryStmt = db.prepare(`
  SELECT 1 FROM webhook_deliveries WHERE delivery_id = ?
`);

const pruneDeliveriesStmt = db.prepare(`
  DELETE FROM webhook_deliveries WHERE received_at < datetime('now', '-' || ? || ' seconds')
`);

export function isDuplicate(deliveryId: string): boolean {
  return !!checkDeliveryStmt.get(deliveryId);
}

export function recordDelivery(d: {
  deliveryId: string;
  provider: string;
  eventType: string;
  projectKey: string;
  repoSlug: string;
  prId: number;
  payloadHash: string;
  verified: boolean;
  status: "accepted" | "rejected" | "duplicate";
  error?: string;
}): void {
  insertDeliveryStmt.run({
    deliveryId: d.deliveryId,
    provider: d.provider,
    eventType: d.eventType,
    projectKey: d.projectKey,
    repoSlug: d.repoSlug,
    prId: d.prId,
    payloadHash: d.payloadHash,
    receivedAt: new Date().toISOString(),
    verified: d.verified ? 1 : 0,
    status: d.status,
    error: d.error ?? null,
  });
}

export function pruneOldDeliveries(ttlSeconds: number): void {
  pruneDeliveriesStmt.run(ttlSeconds);
}

// ─── Rate Limiting ──────────────────────────────────────────────────────────

const rateLimitWindow = 60_000; // 1 minute
const counters = new Map<string, { count: number; windowStart: number }>();

function getCounter(key: string): { count: number; windowStart: number } {
  const now = Date.now();
  const existing = counters.get(key);
  if (existing && now - existing.windowStart < rateLimitWindow) {
    return existing;
  }
  const fresh = { count: 0, windowStart: now };
  counters.set(key, fresh);
  return fresh;
}

export function checkRateLimit(
  projectKey: string,
  repoSlug: string,
  config: ReadinessConfig,
): { allowed: boolean; reason?: string } {
  const repoKey = `repo:${projectKey}/${repoSlug}`;
  const globalKey = "global";

  const repoCounter = getCounter(repoKey);
  if (repoCounter.count >= config.webhookRateLimitPerRepo) {
    return { allowed: false, reason: `Rate limit exceeded for ${projectKey}/${repoSlug}` };
  }

  const globalCounter = getCounter(globalKey);
  if (globalCounter.count >= config.webhookRateLimitGlobal) {
    return { allowed: false, reason: "Global webhook rate limit exceeded" };
  }

  repoCounter.count++;
  globalCounter.count++;
  return { allowed: true };
}

// ─── Unified Webhook Verifier ───────────────────────────────────────────────

export interface WebhookVerifyResult {
  verified: boolean;
  isDuplicate: boolean;
  rateLimited: boolean;
  reason?: string;
}

export function verifyWebhook(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  deliveryId: string | undefined,
  projectKey: string,
  repoSlug: string,
  config?: ReadinessConfig,
): WebhookVerifyResult {
  const cfg = config ?? loadReadinessConfig();
  const sigHeader = signatureHeader || "";

  // Dev bypass — only allow when explicitly configured
  if (cfg.webhookAuthMode === "disabled") {
    // Rate limit still applies even in dev mode
    if (deliveryId && isDuplicate(deliveryId)) {
      return { verified: true, isDuplicate: true, rateLimited: false, reason: "Duplicate delivery" };
    }
    const rl = checkRateLimit(projectKey, repoSlug, cfg);
    if (!rl.allowed) {
      return { verified: true, isDuplicate: false, rateLimited: true, reason: rl.reason };
    }
    return { verified: true, isDuplicate: false, rateLimited: false };
  }

  // HMAC or header-token verification
  let verified = false;
  if (cfg.webhookAuthMode === "header-token") {
    verified = verifyHeaderToken(cfg.webhookSecret, sigHeader);
  } else {
    verified = verifyHmac(cfg.webhookSecret, rawBody, sigHeader);
  }

  if (!verified && cfg.enableWebhookDevBypass) {
    verified = true;
  }

  if (!verified) {
    return { verified: false, isDuplicate: false, rateLimited: false, reason: "Signature verification failed" };
  }

  // Replay check
  if (deliveryId && isDuplicate(deliveryId)) {
    return { verified: true, isDuplicate: true, rateLimited: false, reason: "Duplicate delivery" };
  }

  // Rate limit
  const rl = checkRateLimit(projectKey, repoSlug, cfg);
  if (!rl.allowed) {
    return { verified: true, isDuplicate: false, rateLimited: true, reason: rl.reason };
  }

  return { verified: true, isDuplicate: false, rateLimited: false };
}
