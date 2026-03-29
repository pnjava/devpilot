import { Router, Response } from "express";
import { AuthRequest } from "../auth";
import { getEpics, getStories, searchStories, getIssueDetail } from "../services/jira";

const router = Router();

// List epics
router.get("/epics", async (_req: AuthRequest, res: Response) => {
  try {
    const epics = await getEpics();
    res.json(
      epics.map((e) => ({
        key: e.key,
        summary: e.fields.summary,
        status: e.fields.status.name,
        labels: e.fields.labels,
        assignee: e.fields.assignee?.displayName || null,
      }))
    );
  } catch (err) {
    console.error("Jira epics error:", err);
    res.status(500).json({ error: "Failed to fetch epics" });
  }
});

// List stories (optionally under an epic)
router.get("/stories", async (req: AuthRequest, res: Response) => {
  try {
    const epicKey = req.query.epicKey as string | undefined;
    const stories = await getStories(epicKey);
    res.json(
      stories.map((s) => ({
        key: s.key,
        summary: s.fields.summary,
        status: s.fields.status.name,
        type: s.fields.issuetype.name,
        labels: s.fields.labels,
        priority: s.fields.priority?.name || null,
        assignee: s.fields.assignee?.displayName || null,
      }))
    );
  } catch (err) {
    console.error("Jira stories error:", err);
    res.status(500).json({ error: "Failed to fetch stories" });
  }
});

// Search stories by text
router.get("/search", async (req: AuthRequest, res: Response) => {
  try {
    const q = req.query.q as string;
    if (!q) { res.status(400).json({ error: "q parameter is required" }); return; }
    const results = await searchStories(q);
    res.json(
      results.map((s) => ({
        key: s.key,
        summary: s.fields.summary,
        status: s.fields.status.name,
        type: s.fields.issuetype.name,
        labels: s.fields.labels,
      }))
    );
  } catch (err) {
    console.error("Jira search error:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

// Get single issue detail (for grooming)
router.get("/issue/:key", async (req: AuthRequest, res: Response) => {
  try {
    const issue = await getIssueDetail(req.params.key as string);
    res.json({
      key: issue.key,
      summary: issue.fields.summary,
      description: issue.fields.description,
      status: issue.fields.status.name,
      type: issue.fields.issuetype.name,
      priority: issue.fields.priority?.name || null,
      assignee: issue.fields.assignee?.displayName || null,
      labels: issue.fields.labels,
      comments: issue.fields.comment?.comments?.map((c) => ({
        body: c.body,
        author: c.author.displayName,
      })) || [],
      subtasks: issue.fields.subtasks?.map((st) => ({
        key: st.key,
        summary: st.fields.summary,
        status: st.fields.status.name,
      })) || [],
      url: `${process.env.JIRA_URL}/browse/${issue.key}`,
    });
  } catch (err) {
    console.error("Jira issue error:", err);
    res.status(500).json({ error: "Failed to fetch issue" });
  }
});

export default router;
