/**
 * PR Readiness Route — Jenkins / DevOps consumption API.
 *
 * GET  /api/pr-readiness/:projectKey/:repoSlug/:prId          Full snapshot
 * GET  /api/pr-readiness/:projectKey/:repoSlug/:prId/summary  Lightweight status
 * GET  /api/pr-readiness/:projectKey/:repoSlug/:prId/history  Snapshot history
 * POST /api/pr-readiness/webhook                              Readiness webhook intake
 * POST /api/pr-readiness/refresh                              Manual refresh trigger
 */

import { Router, Response, Request } from "express";
import crypto from "node:crypto";
import type { AuthRequest } from "../auth";
import {
  verifyWebhook,
  recordDelivery,
  enqueueReadinessJob,
  getLatestSnapshot,
  getLatestSnapshotsByRepo,
  getSnapshotHistory,
  buildSummaryResponse,
  getJob,
  getJobsForPR,
  queueDepth,
  runningCount,
  loadReadinessConfig,
  extractJiraKeys,
} from "../services/pr-readiness";
import type {
  PRReadinessRequest,
  PREventType,
} from "../services/pr-readiness";

const router = Router();

// ─── GET /api/pr-readiness/:projectKey/:repoSlug/batch ──────────────────────

router.get("/:projectKey/:repoSlug/batch", (req: Request, res: Response) => {
  try {
    const projectKey = String(req.params.projectKey);
    const repoSlug = String(req.params.repoSlug);
    if (!projectKey || !repoSlug) {
      res.status(400).json({ error: "Invalid parameters" });
      return;
    }
    const snapshots = getLatestSnapshotsByRepo("bitbucket", projectKey, repoSlug);
    const statuses: Record<number, { state: string; risk: string; blockers: number }> = {};
    for (const snap of snapshots) {
      statuses[snap.prId] = {
        state: snap.readinessState,
        risk: snap.overallRisk,
        blockers: snap.blockerCount,
      };
    }
    res.json({ statuses });
  } catch (err) {
    console.error("Batch readiness error:", err);
    res.status(500).json({ error: "Failed to retrieve batch readiness" });
  }
});

// ─── GET /api/pr-readiness/:projectKey/:repoSlug/:prId ─────────────────────

router.get("/:projectKey/:repoSlug/:prId", (req: Request, res: Response) => {
  try {
    const projectKey = String(req.params.projectKey);
    const repoSlug = String(req.params.repoSlug);
    const prIdNum = parseInt(String(req.params.prId), 10);
    if (!projectKey || !repoSlug || !Number.isFinite(prIdNum)) {
      res.status(400).json({ error: "Invalid parameters" });
      return;
    }

    const snap = getLatestSnapshot("bitbucket", projectKey, repoSlug, prIdNum);
    if (!snap) {
      res.status(404).json({
        error: "No readiness snapshot found",
        projectKey,
        repoSlug,
        prId: prIdNum,
      });
      return;
    }

    res.json({ snapshot: snap });
  } catch (err) {
    console.error("Readiness snapshot error:", err);
    res.status(500).json({ error: "Failed to retrieve readiness snapshot" });
  }
});

// ─── GET /api/pr-readiness/:projectKey/:repoSlug/:prId/summary ─────────────

router.get("/:projectKey/:repoSlug/:prId/summary", (req: Request, res: Response) => {
  try {
    const projectKey = String(req.params.projectKey);
    const repoSlug = String(req.params.repoSlug);
    const prIdNum = parseInt(String(req.params.prId), 10);
    if (!projectKey || !repoSlug || !Number.isFinite(prIdNum)) {
      res.status(400).json({ error: "Invalid parameters" });
      return;
    }

    const snap = getLatestSnapshot("bitbucket", projectKey, repoSlug, prIdNum);
    if (!snap) {
      res.status(404).json({
        error: "No readiness snapshot found",
        projectKey,
        repoSlug,
        prId: prIdNum,
      });
      return;
    }

    const cfg = loadReadinessConfig();
    const summary = buildSummaryResponse(snap, cfg.staleTtlMinutes);
    res.json(summary);
  } catch (err) {
    console.error("Readiness summary error:", err);
    res.status(500).json({ error: "Failed to retrieve readiness summary" });
  }
});

// ─── GET /api/pr-readiness/:projectKey/:repoSlug/:prId/history ─────────────

router.get("/:projectKey/:repoSlug/:prId/history", (req: Request, res: Response) => {
  try {
    const projectKey = String(req.params.projectKey);
    const repoSlug = String(req.params.repoSlug);
    const prIdNum = parseInt(String(req.params.prId), 10);
    const limit = Math.min(parseInt(String(req.query.limit || "10"), 10), 50);
    if (!projectKey || !repoSlug || !Number.isFinite(prIdNum)) {
      res.status(400).json({ error: "Invalid parameters" });
      return;
    }

    const history = getSnapshotHistory("bitbucket", projectKey, repoSlug, prIdNum, limit);
    res.json({ count: history.length, snapshots: history });
  } catch (err) {
    console.error("Readiness history error:", err);
    res.status(500).json({ error: "Failed to retrieve readiness history" });
  }
});

// ─── GET /api/pr-readiness/webhook (health check) ─────────────────────────

router.get("/webhook", (_req: Request, res: Response) => {
  res.json({ status: "ok", endpoint: "pr-readiness-webhook", method: "POST required" });
});

// ─── POST /api/pr-readiness/webhook ────────────────────────────────────────

router.post("/webhook", async (req: Request, res: Response) => {
  try {
    const cfg = loadReadinessConfig();
    const body = req.body || {};

    // Extract Bitbucket webhook metadata
    const eventKey = String(
      body.eventKey || body.event_key || body.action || "",
    ).toLowerCase();

    const signatureHeader = String(
      req.headers["x-hub-signature"] ||
      req.headers["x-webhook-signature"] ||
      req.headers["authorization"] ||
      "",
    );

    const deliveryId = String(
      req.headers["x-request-id"] ||
      req.headers["x-event-key"] ||
      crypto.randomUUID(),
    );

    // Normalize PR data from Bitbucket Server webhook payload
    const pullRequest = body.pullRequest || body.pull_request || {};
    const projectKey = String(
      pullRequest.toRef?.repository?.project?.key ||
      pullRequest.fromRef?.repository?.project?.key ||
      body.repository?.project?.key ||
      "",
    );
    const repoSlug = String(
      pullRequest.toRef?.repository?.slug ||
      pullRequest.fromRef?.repository?.slug ||
      body.repository?.slug ||
      "",
    );
    const prId = Number(pullRequest.id || 0);

    if (!projectKey || !repoSlug || !prId) {
      res.status(400).json({
        error: "Cannot extract project/repo/PR from webhook payload",
      });
      return;
    }

    // Verify webhook
    const rawBody = JSON.stringify(body);
    const verification = verifyWebhook(
      rawBody,
      signatureHeader,
      deliveryId,
      projectKey,
      repoSlug,
      cfg,
    );

    if (!verification.verified) {
      recordDelivery({
        deliveryId,
        provider: "bitbucket",
        eventType: eventKey,
        projectKey,
        repoSlug,
        prId,
        payloadHash: hashPayload(rawBody),
        verified: false,
        status: "rejected",
        error: verification.reason,
      });
      res.status(401).json({ error: verification.reason || "Unauthorized" });
      return;
    }

    if (verification.isDuplicate) {
      res.json({ accepted: true, duplicate: true, reason: "Already processed" });
      return;
    }

    if (verification.rateLimited) {
      res.status(429).json({ error: verification.reason || "Rate limited" });
      return;
    }

    // Map Bitbucket event to our event type
    const eventType = mapEventType(eventKey);
    if (!eventType) {
      recordDelivery({
        deliveryId,
        provider: "bitbucket",
        eventType: eventKey,
        projectKey,
        repoSlug,
        prId,
        payloadHash: hashPayload(rawBody),
        verified: true,
        status: "accepted",
      });
      res.json({
        accepted: true,
        ignored: true,
        reason: `Unsupported event: ${eventKey}`,
      });
      return;
    }

    // Build readiness request
    const jiraKeys = extractJiraKeys(
      pullRequest.title || "",
      pullRequest.description || "",
    );

    const request: PRReadinessRequest = {
      provider: "bitbucket",
      projectKey,
      repoSlug,
      prId,
      prUrl: pullRequest.links?.self?.[0]?.href || "",
      title: pullRequest.title || "",
      description: pullRequest.description || "",
      author: pullRequest.author?.user?.displayName || "unknown",
      sourceBranch: pullRequest.fromRef?.displayId || "",
      targetBranch: pullRequest.toRef?.displayId || "",
      latestCommitSha:
        (pullRequest as any).fromRef?.latestCommit ||
        (pullRequest as any).properties?.mergeResult?.current?.id ||
        "",
      eventType,
      eventTimestamp: new Date().toISOString(),
      linkedJiraKeys: jiraKeys,
      dryRun: false,
      reasonForEvaluation: `Webhook: ${eventKey}`,
    };

    // Enqueue the job
    const result = enqueueReadinessJob(request);

    // Record delivery
    recordDelivery({
      deliveryId,
      provider: "bitbucket",
      eventType: eventKey,
      projectKey,
      repoSlug,
      prId,
      payloadHash: hashPayload(rawBody),
      verified: true,
      status: "accepted",
    });

    res.json({
      accepted: true,
      jobId: result.jobId,
      enqueued: result.enqueued,
      superseded: result.superseded,
      eventType,
    });
  } catch (err) {
    console.error("Readiness webhook error:", err);
    res.status(500).json({ error: "Failed to process readiness webhook" });
  }
});

// ─── POST /api/pr-readiness/refresh ────────────────────────────────────────

router.post("/refresh", (req: AuthRequest, res: Response) => {
  try {
    const body = req.body || {};
    const projectKey = String(body.projectKey || "").trim();
    const repoSlug = String(body.repoSlug || "").trim();
    const prId = Number(body.prId || 0);
    const prUrl = String(body.prUrl || "").trim();

    if (!projectKey || !repoSlug || !prId) {
      res.status(400).json({
        error: "projectKey, repoSlug, and prId are required",
      });
      return;
    }

    const request: PRReadinessRequest = {
      provider: "bitbucket",
      projectKey,
      repoSlug,
      prId,
      prUrl,
      title: String(body.title || ""),
      description: String(body.description || ""),
      author: String(body.author || req.user?.username || "unknown"),
      sourceBranch: String(body.sourceBranch || ""),
      targetBranch: String(body.targetBranch || ""),
      latestCommitSha: String(body.commitSha || ""),
      eventType: "manual_refresh",
      eventTimestamp: new Date().toISOString(),
      linkedJiraKeys: Array.isArray(body.jiraKeys) ? body.jiraKeys : [],
      dryRun: body.dryRun === true,
      reasonForEvaluation: "Manual refresh",
    };

    const result = enqueueReadinessJob(request, { priority: 10 });
    res.json({
      accepted: true,
      jobId: result.jobId,
      enqueued: result.enqueued,
    });
  } catch (err) {
    console.error("Readiness refresh error:", err);
    res.status(500).json({ error: "Failed to enqueue refresh" });
  }
});

// ─── POST /api/pr-readiness/bootstrap ──────────────────────────────────────

router.post("/bootstrap", async (req: Request, res: Response) => {
  try {
    const projectKey = String((req.body || {}).projectKey || process.env.BITBUCKET_PROJECT || "BMN").trim();
    const { bootstrapOpenPRs } = await import("../services/pr-readiness");
    const result = await bootstrapOpenPRs(projectKey);
    res.json({ accepted: true, ...result });
  } catch (err) {
    console.error("Bootstrap error:", err);
    res.status(500).json({ error: "Failed to bootstrap open PRs" });
  }
});

// ─── GET /api/pr-readiness/queue/status ────────────────────────────────────

router.get("/queue/status", (_req: Request, res: Response) => {
  res.json({
    queued: queueDepth(),
    running: runningCount(),
  });
});

// ─── GET /api/pr-readiness/job/:jobId ──────────────────────────────────────

router.get("/job/:jobId", (req: Request, res: Response) => {
  const job = getJob(String(req.params.jobId));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({ job });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function mapEventType(eventKey: string): PREventType | null {
  const key = eventKey.toLowerCase().replace(/_/g, ":");
  switch (key) {
    case "pr:opened":
      return "pr:opened";
    case "pr:modified":
      return "pr:modified";
    case "pr:from_ref_updated":
    case "pr:synchronize":
    case "synchronize":
      return "pr:from_ref_updated";
    case "pr:reopened":
      return "pr:reopened";
    case "pr:reviewer:updated":
      return "pr:reviewer:updated";
    default:
      return null;
  }
}

function hashPayload(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

export default router;
