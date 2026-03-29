import { Router, Response } from "express";
import { AuthRequest } from "../auth";
import db from "../db";
import {
  getRepos,
  getPullRequests,
  getPullRequest,
  getPRDiff,
  listRepoWebhooks,
  createRepoWebhook,
  updateRepoWebhook,
} from "../services/bitbucket-server";

const router = Router();

// List repos in the configured project
router.get("/repos", async (_req: AuthRequest, res: Response) => {
  try {
    const repos = await getRepos();
    res.json(
      repos.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        project: r.project.key,
        url: r.links.self?.[0]?.href || "",
      }))
    );
  } catch (err) {
    console.error("Bitbucket repos error:", err);
    res.status(500).json({ error: "Failed to fetch Bitbucket repos" });
  }
});

// List open PRs for a repo — optionally filter to team members only
router.get("/repos/:slug/pull-requests", async (req: AuthRequest, res: Response) => {
  try {
    const slug = req.params.slug as string;
    const state = (req.query.state as string) || "OPEN";
    const teamOnly = req.query.teamOnly === "true";

    const prs = await getPullRequests(slug, state);

    // Build team member name list once if filtering
    let teamNames: Set<string> | null = null;
    if (teamOnly) {
      const members = db
        .prepare("SELECT bitbucket_name, display_name FROM team_members WHERE active = 1")
        .all() as { bitbucket_name: string | null; display_name: string }[];
      teamNames = new Set(
        members.flatMap((m) =>
          [m.bitbucket_name, m.display_name].filter(Boolean) as string[]
        )
      );
    }

    const filtered = teamOnly && teamNames
      ? prs.filter((pr) => teamNames!.has(pr.author.user.displayName))
      : prs;

    res.json(
      filtered.map((pr) => ({
        id: pr.id,
        title: pr.title,
        description: pr.description,
        state: pr.state,
        author: pr.author.user.displayName,
        branch: pr.fromRef.displayId,
        target: pr.toRef.displayId,
        reviewers: pr.reviewers.map((r) => ({
          name: r.user.displayName,
          status: r.status,
        })),
        createdDate: pr.createdDate,
        url: pr.links.self?.[0]?.href || "",
      }))
    );
  } catch (err) {
    console.error("Bitbucket PRs error:", err);
    res.status(500).json({ error: "Failed to fetch pull requests" });
  }
});

// Get single PR detail
router.get("/repos/:slug/pull-requests/:prId", async (req: AuthRequest, res: Response) => {
  try {
    const slug = req.params.slug as string;
    const prId = parseInt(req.params.prId as string);
    const pr = await getPullRequest(slug, prId);
    res.json(pr);
  } catch (err) {
    console.error("Bitbucket PR error:", err);
    res.status(500).json({ error: "Failed to fetch pull request" });
  }
});

// Get PR diff
router.get("/repos/:slug/pull-requests/:prId/diff", async (req: AuthRequest, res: Response) => {
  try {
    const slug = req.params.slug as string;
    const prId = parseInt(req.params.prId as string);
    const diff = await getPRDiff(slug, prId);
    res.json(diff);
  } catch (err) {
    console.error("Bitbucket diff error:", err);
    res.status(500).json({ error: "Failed to fetch diff" });
  }
});

// Create/update PR readiness webhooks for repos from GroomPilot
router.post("/webhooks/readiness/setup", async (req: AuthRequest, res: Response) => {
  try {
    const projectKey = String(req.body?.projectKey || process.env.BITBUCKET_PROJECT || "BMN");
    const repoSlugs = Array.isArray(req.body?.repoSlugs)
      ? req.body.repoSlugs.map((s: any) => String(s)).filter(Boolean)
      : [];
    const incomingWebhookUrl = String(req.body?.webhookUrl || "").trim();
    const webhookUrl = incomingWebhookUrl || String(process.env.READINESS_WEBHOOK_PUBLIC_URL || "").trim();
    const events = Array.isArray(req.body?.events) && req.body.events.length > 0
      ? req.body.events.map((e: any) => String(e))
      : [
          "pr:opened",
          "pr:modified",
          "pr:from_ref_updated",
          "pr:reopened",
          "pr:reviewer:updated",
        ];

    if (!webhookUrl) {
      res.status(400).json({
        error:
          "webhookUrl is required. Pass it in request body or set READINESS_WEBHOOK_PUBLIC_URL env var.",
      });
      return;
    }

    const secret = String(process.env.BITBUCKET_WEBHOOK_SECRET || "").trim();
    if (!secret) {
      res.status(400).json({
        error: "BITBUCKET_WEBHOOK_SECRET is required before setting up webhooks.",
      });
      return;
    }

    const targetRepos = repoSlugs.length > 0
      ? repoSlugs
      : (await getRepos(projectKey)).map((r) => r.slug);

    const results: Array<{ repoSlug: string; status: "created" | "updated" | "error"; webhookId?: number; error?: string }> = [];

    for (const repoSlug of targetRepos) {
      try {
        const hooks = await listRepoWebhooks(repoSlug, projectKey);
        const existing = hooks.find(
          (h) => h.url === webhookUrl || String(h.name || "").toLowerCase().includes("groompilot readiness")
        );

        const payload = {
          name: "GroomPilot Readiness",
          url: webhookUrl,
          active: true,
          events,
          configuration: {
            secret,
          },
        };

        if (existing) {
          const updated = await updateRepoWebhook(repoSlug, existing.id, payload, projectKey);
          results.push({ repoSlug, status: "updated", webhookId: updated.id });
        } else {
          const created = await createRepoWebhook(repoSlug, payload, projectKey);
          results.push({ repoSlug, status: "created", webhookId: created.id });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ repoSlug, status: "error", error: message });
      }
    }

    const created = results.filter((r) => r.status === "created").length;
    const updated = results.filter((r) => r.status === "updated").length;
    const failed = results.filter((r) => r.status === "error").length;

    res.json({
      projectKey,
      webhookUrl,
      totalRepos: targetRepos.length,
      created,
      updated,
      failed,
      results,
    });
  } catch (err) {
    console.error("Bitbucket webhook setup error:", err);
    res.status(500).json({ error: "Failed to setup Bitbucket webhooks from GroomPilot" });
  }
});

export default router;
