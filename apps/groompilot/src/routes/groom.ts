import { Router, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { AuthRequest } from "../auth";
import { expandStory, getStoryContext, GroomingInput } from "../services/grooming";
import { analyzeRepo } from "../services/repo-analysis";
import { getStory } from "../services/github";
import { getIssueDetail, descriptionToString, commentBodyToString } from "../services/jira";
import { getKnowledgeContextForJira } from "../services/knowledge-warehouse";
import db from "../db";

const router = Router();

function getAccessToken(userId: string): string | null {
  const row = db.prepare("SELECT access_token FROM users WHERE id = ?").get(userId) as
    | { access_token: string }
    | undefined;
  return row?.access_token ?? null;
}

// Start grooming a story — supports both GitHub issues and Jira stories
router.post("/start", async (req: AuthRequest, res: Response) => {
  try {
    const { owner, repo, issueNumber, jiraKey, additionalContext, repoSlug } = req.body;

    let input: GroomingInput;
    let storyUrl: string;
    let storyTitle: string;
    let storyId: string;

    if (jiraKey) {
      // Jira story
      const issue = await getIssueDetail(jiraKey);
      storyTitle = issue.fields.summary;
      storyId = issue.key;
      storyUrl = `${process.env.JIRA_URL}/browse/${issue.key}`;
      input = {
        storyTitle: issue.fields.summary,
        storyBody: descriptionToString(issue.fields.description),
        storyLabels: issue.fields.labels || [],
        comments: issue.fields.comment?.comments?.map((c) => commentBodyToString(c.body)) || [],
        repoContext: additionalContext,
        jiraKey: jiraKey,
        repoSlug: repoSlug,
      };

      // Enrich grooming with warehouse context mapped to this Jira.
      try {
        const k = getKnowledgeContextForJira(String(jiraKey), 20);
        if (k.contextText) {
          const prefix = input.repoContext ? `${input.repoContext}\n\n` : "";
          input.repoContext = `${prefix}Knowledge Warehouse Context\n${k.contextText}`;
        }
      } catch (err) {
        console.warn("Knowledge context enrichment skipped:", err);
      }
    } else if (owner && repo && issueNumber) {
      // GitHub issue
      const token = getAccessToken(req.user!.id);
      if (!token) { res.status(401).json({ error: "No token" }); return; }
      const { issue, comments } = await getStory(token, owner, repo, parseInt(issueNumber));
      storyTitle = issue.title;
      storyId = String(issue.number);
      storyUrl = issue.html_url;
      input = {
        storyTitle: issue.title,
        storyBody: issue.body || "",
        storyLabels: (issue.labels as Array<{ name: string } | string>).map((l) =>
          typeof l === "string" ? l : l.name
        ),
        comments: comments.map((c) => c.body || ""),
        repoContext: additionalContext,
      };
    } else {
      res.status(400).json({ error: "Provide jiraKey or (owner, repo, issueNumber)" });
      return;
    }

    // If a repo was selected, analyze the actual codebase FIRST so grooming can use it
    let codeAnalysis: import("../services/grooming").CodeAnalysisResult | undefined;
    if (repoSlug) {
      try {
        const storyCtx = getStoryContext(input);
        const analysis = await analyzeRepo(repoSlug, storyCtx);
        codeAnalysis = {
          repoSlug: analysis.repoSlug,
          summary: analysis.summary,
          alreadyDone: analysis.alreadyDone,
          needsChange: analysis.needsChange,
          newWork: analysis.newWork,
          filesChecked: analysis.filesChecked,
        };
      } catch (err) {
        console.error("Repo analysis error:", err);
        // Non-fatal — grooming still works without code analysis
      }
    }

    const result = await expandStory(input, codeAnalysis);
    if (codeAnalysis) {
      result.codeAnalysis = codeAnalysis;
    }

    // Save session
    const sessionId = uuidv4();
    db.prepare(
      "INSERT INTO sessions (id, title, story_id, repo_owner, repo_name, created_by, data) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      sessionId,
      storyTitle,
      storyId,
      owner || "jira",
      repo || storyId,
      req.user!.id,
      JSON.stringify({ input, result, storyUrl })
    );

    // Save to history
    db.prepare(
      "INSERT INTO grooming_history (id, session_id, action, payload, created_by) VALUES (?, ?, ?, ?, ?)"
    ).run(uuidv4(), sessionId, "groom_start", JSON.stringify(result), req.user!.id);

    res.json({ sessionId, storyUrl, ...result });
  } catch (err) {
    console.error("Groom error:", err);
    res.status(500).json({ error: "Failed to groom story" });
  }
});

// Generate subtasks for a session
router.post("/subtasks", async (req: AuthRequest, res: Response) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }

    const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as
      | { data: string }
      | undefined;
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const data = JSON.parse(session.data);
    res.json({ subtasks: data.result?.subtasks || [] });
  } catch (err) {
    console.error("Subtasks error:", err);
    res.status(500).json({ error: "Failed to generate subtasks" });
  }
});

// Get session
router.get("/session/:id", async (req: AuthRequest, res: Response) => {
  try {
    const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id) as
      | { id: string; title: string; data: string; created_at: string }
      | undefined;
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json({ ...session, data: JSON.parse(session.data) });
  } catch (err) {
    console.error("Session error:", err);
    res.status(500).json({ error: "Failed to get session" });
  }
});

// List sessions
router.get("/sessions", async (req: AuthRequest, res: Response) => {
  try {
    const sessions = db
      .prepare("SELECT id, title, story_id, repo_owner, repo_name, created_at FROM sessions WHERE created_by = ? ORDER BY created_at DESC LIMIT 50")
      .all(req.user!.id);
    res.json(sessions);
  } catch (err) {
    console.error("Sessions error:", err);
    res.status(500).json({ error: "Failed to list sessions" });
  }
});

// Save snapshot
router.post("/snapshot", async (req: AuthRequest, res: Response) => {
  try {
    const { sessionId, snapshotData } = req.body;
    const id = uuidv4();
    db.prepare(
      "INSERT INTO snapshots (id, session_id, snapshot_data, created_by) VALUES (?, ?, ?, ?)"
    ).run(id, sessionId, JSON.stringify(snapshotData), req.user!.id);
    res.json({ id });
  } catch (err) {
    console.error("Snapshot error:", err);
    res.status(500).json({ error: "Failed to save snapshot" });
  }
});

// Get formatted specs from a grooming session (for PR review integration)
router.get("/session/:id/specs", async (req: AuthRequest, res: Response) => {
  try {
    const session = db.prepare("SELECT data FROM sessions WHERE id = ? AND created_by = ?").get(req.params.id, req.user!.id) as
      | { data: string }
      | undefined;
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const data = JSON.parse(session.data);
    const result = data.result;
    if (!result) {
      res.json({ specs: "" });
      return;
    }
    const parts: string[] = [];
    if (result.acceptanceCriteria?.length) {
      parts.push("ACCEPTANCE CRITERIA:");
      result.acceptanceCriteria.forEach((ac: string, i: number) => parts.push(`  ${i + 1}. ${ac}`));
    }
    if (result.scenarios?.length) {
      parts.push("\nSCENARIOS:");
      result.scenarios.forEach((s: any) => {
        parts.push(`  - ${s.name}`);
        if (s.given) parts.push(`    Given: ${s.given}`);
        if (s.when) parts.push(`    When: ${s.when}`);
        if (s.then) parts.push(`    Then: ${s.then}`);
      });
    }
    if (result.expectedBehavior?.length) {
      parts.push("\nEXPECTED BEHAVIOR:");
      result.expectedBehavior.forEach((eb: string) => parts.push(`  - ${eb}`));
    }
    res.json({ specs: parts.join("\n") });
  } catch (err) {
    console.error("Session specs error:", err);
    res.status(500).json({ error: "Failed to get session specs" });
  }
});

export default router;
