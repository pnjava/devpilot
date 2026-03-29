import express from "express";
import cors from "cors";
import helmet from "helmet";
import http from "http";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

import { authMiddleware } from "./auth";
import { initSocket } from "./socket";
import authRoutes from "./routes/auth";
import reposRoutes from "./routes/repos";
import groomRoutes from "./routes/groom";
import prReviewRoutes from "./routes/pr-review";
import emailRoutes from "./routes/email";
import jiraRoutes from "./routes/jira";
import bitbucketRoutes from "./routes/bitbucket";
import aiRoutes from "./routes/ai";
import rcieRoutes from "./routes/rcie";
import knowledgeRoutes from "./routes/knowledge";
import prReadinessRoutes from "./routes/pr-readiness";
import teamMembersRoutes from "./routes/team-members";
import storyReadinessRoutes from "./routes/story-readiness";
import { scheduleBatchRunner } from "./services/bpe-batch-runner";
import { scheduleIndexRunner } from "./services/repo-code-index-runner";
import { getProviderInfo } from "./services/ai-provider";
import {
  startReadinessWorker,
  stopReadinessWorker,
  buildReadinessSnapshot,
  saveSnapshot,
  saveWatchState,
  refineLLM,
  loadReadinessConfig,
  startReconciler,
  stopReconciler,
  pruneOldJobs,
  pruneOldSnapshots,
  pruneOldDeliveries,
  bootstrapOpenPRs,
} from "./services/pr-readiness";

const app = express();
const server = http.createServer(app);
const PORT = parseInt(process.env.PORT || "4000");

// Raise event-listener limit to avoid MaxListenersExceededWarning from tsx watch
process.setMaxListeners(20);
server.setMaxListeners(20);

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true,
}));
app.use(express.json({ limit: "5mb" }));

// Public routes
app.use("/api/auth", authRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Protected routes
app.use("/api/repos", authMiddleware, reposRoutes);
app.use("/api/groom", authMiddleware, groomRoutes);
app.use("/api/pr", (req, res, next) => {
  if (req.path === "/webhook") {
    next();
    return;
  }
  authMiddleware(req as any, res, next);
}, prReviewRoutes);
app.use("/api/pr-readiness", (req, res, next) => {
  if (req.path === "/webhook" || req.path === "/refresh" || req.path === "/bootstrap" || req.path === "/queue/status" || req.path.endsWith("/batch")) {
    next();
    return;
  }
  authMiddleware(req as any, res, next);
}, prReadinessRoutes);
app.use("/api/email", authMiddleware, emailRoutes);
app.use("/api/jira", authMiddleware, jiraRoutes);
app.use("/api/bitbucket", (req, res, next) => {
  if (req.path === "/webhooks/readiness/setup") {
    next();
    return;
  }
  authMiddleware(req as any, res, next);
}, bitbucketRoutes);
app.use("/api/ai", authMiddleware, aiRoutes);
app.use("/api/rcie", authMiddleware, rcieRoutes);
app.use("/api/knowledge", authMiddleware, knowledgeRoutes);
app.use("/api/team-members", authMiddleware, teamMembersRoutes);
app.use("/api/story-readiness", authMiddleware, storyReadinessRoutes);

// Serve React frontend in production
const frontendBuild = path.join(__dirname, "..", "..", "frontend", "dist");
app.use(express.static(frontendBuild));
app.get("*", (_req, res) => {
  res.sendFile(path.join(frontendBuild, "index.html"));
});

// Socket.io
initSocket(server);

server.listen(PORT, () => {
  const ai = getProviderInfo();
  console.log(`🚀 GroomPilot backend running on port ${PORT}`);
  console.log(`   API:    http://localhost:${PORT}/api`);
  console.log(`   Health: http://localhost:${PORT}/api/health`);
  console.log(`   AI Provider: ${ai.provider} (model: ${ai.model})`);
  scheduleBatchRunner();
  scheduleIndexRunner();

  const readinessReconcilerEnabled =
    String(process.env.READINESS_RECONCILER_ENABLED || "true").toLowerCase() !== "false";
  const readinessBootstrapOnStartup =
    String(process.env.READINESS_BOOTSTRAP_ON_STARTUP || "false").toLowerCase() === "true";

  // PR Readiness pipeline workers
  const readinessCfg = loadReadinessConfig();
  startReadinessWorker(async (job, request) => {
    const snapshot = await buildReadinessSnapshot(request);
    saveSnapshot(snapshot);
    saveWatchState({
      provider: "bitbucket",
      projectKey: request.projectKey,
      repoSlug: request.repoSlug,
      prId: request.prId,
      latestSeenCommitSha: request.latestCommitSha,
      latestJiraFingerprint: request.linkedJiraKeys.slice().sort().join(","),
      lastSnapshotId: snapshot.id,
      lastRefreshAt: new Date().toISOString(),
    });
    // Optional async LLM refinement
    if (readinessCfg.enableLlmRefinement) {
      refineLLM(snapshot.id, readinessCfg).catch((err) =>
        console.error("[readiness-llm] refinement error:", err),
      );
    }
  }, { concurrency: readinessCfg.workerConcurrency });

  if (readinessReconcilerEnabled) {
    startReconciler();
  } else {
    console.log("[reconciler] disabled via READINESS_RECONCILER_ENABLED=false");
  }

  // Purge stale failed jobs from previous runs (e.g. deleted repos)
  try {
    const db = require("./db").default;
    const purged = db.prepare(
      `DELETE FROM pr_readiness_jobs WHERE status = 'failed'`
    ).run();
    if (purged.changes > 0) {
      console.log(`[readiness] purged ${purged.changes} stale failed job(s) from prior runs`);
    }
  } catch {/* non-critical */}

  // Bootstrap: optional enqueue of all open PRs on startup (default disabled)
  if (readinessBootstrapOnStartup) {
    setTimeout(() => {
      bootstrapOpenPRs().catch((err) =>
        console.error("[bootstrap] startup seeding failed:", err),
      );
    }, 10_000);
  } else {
    console.log("[bootstrap] skipped (set READINESS_BOOTSTRAP_ON_STARTUP=true to enable)");
  }

  // Periodic cleanup
  setInterval(() => {
    pruneOldJobs(30);
    pruneOldSnapshots(5, 90);
    pruneOldDeliveries(readinessCfg.webhookReplayTtlSeconds);
  }, 6 * 3_600_000); // every 6 hours
});
