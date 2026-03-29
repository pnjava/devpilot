import { Router, Response } from "express";
import { AuthRequest } from "../auth";
import { getUserRepos, getRepoIssues, getStory, getLabels } from "../services/github";
import db from "../db";

const router = Router();

function getAccessToken(userId: string): string | null {
  const row = db.prepare("SELECT access_token FROM users WHERE id = ?").get(userId) as
    | { access_token: string }
    | undefined;
  return row?.access_token ?? null;
}

// List user's repos
router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const token = getAccessToken(req.user!.id);
    if (!token) { res.status(401).json({ error: "No token" }); return; }
    const repos = await getUserRepos(token);
    res.json(repos.map((r) => ({
      id: r.id,
      name: r.name,
      full_name: r.full_name,
      owner: r.owner.login,
      description: r.description,
      private: r.private,
      updated_at: r.updated_at,
    })));
  } catch (err) {
    console.error("Repos error:", err);
    res.status(500).json({ error: "Failed to fetch repos" });
  }
});

// List issues for a repo
router.get("/:owner/:repo/issues", async (req: AuthRequest, res: Response) => {
  try {
    const token = getAccessToken(req.user!.id);
    if (!token) { res.status(401).json({ error: "No token" }); return; }
    const owner = req.params.owner as string;
    const repo = req.params.repo as string;
    const issues = await getRepoIssues(token, owner, repo);
    res.json(issues);
  } catch (err) {
    console.error("Issues error:", err);
    res.status(500).json({ error: "Failed to fetch issues" });
  }
});

// Get single story/issue
router.get("/:owner/:repo/issues/:number", async (req: AuthRequest, res: Response) => {
  try {
    const token = getAccessToken(req.user!.id);
    if (!token) { res.status(401).json({ error: "No token" }); return; }
    const owner = req.params.owner as string;
    const repo = req.params.repo as string;
    const issueNumber = parseInt(req.params.number as string);
    const data = await getStory(token, owner, repo, issueNumber);
    res.json(data);
  } catch (err) {
    console.error("Story error:", err);
    res.status(500).json({ error: "Failed to fetch story" });
  }
});

// Get labels
router.get("/:owner/:repo/labels", async (req: AuthRequest, res: Response) => {
  try {
    const token = getAccessToken(req.user!.id);
    if (!token) { res.status(401).json({ error: "No token" }); return; }
    const owner = req.params.owner as string;
    const repo = req.params.repo as string;
    const labels = await getLabels(token, owner, repo);
    res.json(labels);
  } catch (err) {
    console.error("Labels error:", err);
    res.status(500).json({ error: "Failed to fetch labels" });
  }
});

export default router;
