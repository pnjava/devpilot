// ─────────────────────────────────────────────────────────────
// Story Readiness — API Routes
// ─────────────────────────────────────────────────────────────
import { Router, Response } from "express";
import { AuthRequest } from "../auth";
import {
  analyzeStory,
  getLatestSnapshot,
  getSnapshotHistory,
  saveFeedback,
  buildJiraPayload,
  getMetricsSummary,
  recordFeedback,
  recordJiraPreview,
} from "../services/story-readiness";
import type { StoryReadinessRequest, RunMode, TriggerSource } from "../services/story-readiness";

const router = Router();

// ── POST /api/story-readiness/analyze ──────────────────────
// Run full readiness analysis on a Jira story
router.post("/analyze", async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body as Partial<StoryReadinessRequest>;

    if (!body.jiraKey || !body.title) {
      res.status(400).json({ error: "jiraKey and title are required" });
      return;
    }

    const request: StoryReadinessRequest = {
      jiraKey: body.jiraKey,
      title: body.title,
      description: body.description || "",
      acceptanceCriteria: body.acceptanceCriteria || "",
      epicKey: body.epicKey,
      issueType: body.issueType,
      labels: body.labels || [],
      assignee: body.assignee,
      reporter: body.reporter,
      status: body.status,
      componentTags: body.componentTags || [],
      storyLinks: body.storyLinks || [],
      linkedConfluenceUrls: body.linkedConfluenceUrls || [],
      manualContextText: body.manualContextText,
      triggerSource: (body.triggerSource || "ui") as TriggerSource,
      requestedBy: (req as any).user?.username || body.requestedBy,
      runMode: (body.runMode || "analyze_and_persist") as RunMode,
    };

    const result = await analyzeStory(request);

    res.json({
      snapshot: result.snapshot,
      persisted: result.persisted,
      knowledgeContextUsed: result.knowledgeContextUsed,
    });
  } catch (err) {
    console.error("story-readiness analyze error:", err);
    res.status(500).json({ error: "Analysis failed" });
  }
});

// ── POST /api/story-readiness/refresh/:jiraKey ─────────────
// Re-analyze a previously analyzed story
router.post("/refresh/:jiraKey", async (req: AuthRequest, res: Response) => {
  try {
    const { jiraKey } = req.params as { jiraKey: string };
    const body = req.body as Partial<StoryReadinessRequest>;

    if (!body.title) {
      res.status(400).json({ error: "title is required in body" });
      return;
    }

    const request: StoryReadinessRequest = {
      jiraKey,
      title: body.title,
      description: body.description || "",
      acceptanceCriteria: body.acceptanceCriteria || "",
      epicKey: body.epicKey,
      issueType: body.issueType,
      labels: body.labels || [],
      assignee: body.assignee,
      reporter: body.reporter,
      status: body.status,
      componentTags: body.componentTags || [],
      storyLinks: body.storyLinks || [],
      linkedConfluenceUrls: body.linkedConfluenceUrls || [],
      manualContextText: body.manualContextText,
      triggerSource: "refresh",
      requestedBy: (req as any).user?.username,
      runMode: "analyze_and_persist",
    };

    const result = await analyzeStory(request);

    res.json({
      snapshot: result.snapshot,
      persisted: result.persisted,
      knowledgeContextUsed: result.knowledgeContextUsed,
    });
  } catch (err) {
    console.error("story-readiness refresh error:", err);
    res.status(500).json({ error: "Refresh failed" });
  }
});

// ── GET /api/story-readiness/metrics ────────────────────────
// Aggregate telemetry for readiness feature usage
// NOTE: Must be defined BEFORE /:jiraKey to avoid route conflict
router.get("/metrics", (_req: AuthRequest, res: Response) => {
  try {
    const days = parseInt(_req.query.days as string) || 30;
    const summary = getMetricsSummary(Math.min(days, 365));
    res.json(summary);
  } catch (err) {
    console.error("story-readiness metrics error:", err);
    res.status(500).json({ error: "Failed to retrieve metrics" });
  }
});

// ── GET /api/story-readiness/:jiraKey ──────────────────────
// Get the latest readiness snapshot for a story
router.get("/:jiraKey", (_req: AuthRequest, res: Response) => {
  try {
    const { jiraKey } = _req.params as { jiraKey: string };
    const snapshot = getLatestSnapshot(jiraKey);

    if (!snapshot) {
      res.status(404).json({ error: "No readiness snapshot found for this story" });
      return;
    }

    res.json(snapshot);
  } catch (err) {
    console.error("story-readiness get error:", err);
    res.status(500).json({ error: "Failed to retrieve snapshot" });
  }
});

// ── GET /api/story-readiness/:jiraKey/history ──────────────
// Get snapshot history for a story
router.get("/:jiraKey/history", (_req: AuthRequest, res: Response) => {
  try {
    const { jiraKey } = _req.params as { jiraKey: string };
    const limit = parseInt(_req.query.limit as string) || 10;
    const history = getSnapshotHistory(jiraKey, Math.min(limit, 50));

    res.json({ jiraKey, snapshots: history, count: history.length });
  } catch (err) {
    console.error("story-readiness history error:", err);
    res.status(500).json({ error: "Failed to retrieve history" });
  }
});

// ── POST /api/story-readiness/:jiraKey/prepare-jira-update ─
// Build a Jira comment + subtask payload (dry-run preview)
router.post("/:jiraKey/prepare-jira-update", (_req: AuthRequest, res: Response) => {
  try {
    const { jiraKey } = _req.params as { jiraKey: string };
    const { selectedSubtaskIds, includeComment, includeSubtasks } = _req.body as {
      selectedSubtaskIds?: string[];
      includeComment?: boolean;
      includeSubtasks?: boolean;
    };

    const snapshot = getLatestSnapshot(jiraKey);
    if (!snapshot) {
      res.status(404).json({ error: "No readiness snapshot found — run analysis first" });
      return;
    }

    const payload = buildJiraPayload(snapshot, {
      selectedSubtaskIds,
      includeComment: includeComment !== false,
      includeSubtasks: includeSubtasks !== false,
      dryRun: true, // always dry-run in phase 1
    });

    try { recordJiraPreview(jiraKey); } catch { /* telemetry must not break request */ }

    res.json(payload);
  } catch (err) {
    console.error("story-readiness prepare-jira error:", err);
    res.status(500).json({ error: "Failed to build Jira payload" });
  }
});

// ── POST /api/story-readiness/:jiraKey/feedback ────────────
// Submit feedback on a readiness snapshot
router.post("/:jiraKey/feedback", (req: AuthRequest, res: Response) => {
  try {
    const { jiraKey } = req.params as { jiraKey: string };
    const { snapshotId, feedbackType, feedbackText, acceptedQuestionIds, acceptedSubtaskIds } = req.body as {
      snapshotId: string;
      feedbackType?: string;
      feedbackText?: string;
      acceptedQuestionIds?: string[];
      acceptedSubtaskIds?: string[];
    };

    if (!snapshotId) {
      res.status(400).json({ error: "snapshotId is required" });
      return;
    }

    const id = saveFeedback({
      jiraKey,
      snapshotId,
      feedbackType: feedbackType || "general",
      feedbackText: feedbackText || "",
      acceptedQuestionIds: acceptedQuestionIds || [],
      acceptedSubtaskIds: acceptedSubtaskIds || [],
      createdBy: (req as any).user?.username || "anonymous",
    });

    try {
      recordFeedback(
        jiraKey,
        (acceptedSubtaskIds || []).length,
        0, // rejected count not tracked in this call shape
      );
    } catch { /* telemetry must not break request */ }

    res.status(201).json({ id, jiraKey, snapshotId });
  } catch (err) {
    console.error("story-readiness feedback error:", err);
    res.status(500).json({ error: "Failed to save feedback" });
  }
});

export default router;
