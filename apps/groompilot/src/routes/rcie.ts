import { Router, Response } from "express";
import { AuthRequest } from "../auth";
import {
  getRepoIndexStats,
  getIndexRunHistory,
  getAllCodeFiles,
  getSymbolsForFile,
  getDependenciesFrom,
  getDependenciesTo,
  getGuardsForFile,
  getAnnotationsForFile,
  getAISummary,
  getBaselineVulnsForFile,
  acknowledgeBaselineVuln,
} from "../services/repo-code-index-store";
import { runIndexForRepo } from "../services/repo-code-index-runner";
import { resolveDelta } from "../services/repo-code-delta-resolver";

const router = Router();

// GET /api/rcie/status/:repoSlug — Index stats for a repo
router.get("/status/:repoSlug", (req: AuthRequest, res: Response) => {
  try {
    const repoSlug = String(req.params.repoSlug);
    const stats = getRepoIndexStats(repoSlug);
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to get index status" });
  }
});

// GET /api/rcie/history/:repoSlug — Index run history
router.get("/history/:repoSlug", (req: AuthRequest, res: Response) => {
  try {
    const repoSlug = String(req.params.repoSlug);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const history = getIndexRunHistory(repoSlug, limit);
    res.json(history);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to get index history" });
  }
});

// POST /api/rcie/index/:repoSlug — Trigger indexing for a repo
router.post("/index/:repoSlug", async (req: AuthRequest, res: Response) => {
  try {
    const repoSlug = String(req.params.repoSlug);
    const { fullReindex, commitSha } = req.body || {};
    const result = await runIndexForRepo(repoSlug, {
      fullReindex: fullReindex === true,
      commitSha: typeof commitSha === "string" ? commitSha : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Indexing failed" });
  }
});

// GET /api/rcie/files/:repoSlug — List indexed files
router.get("/files/:repoSlug", (req: AuthRequest, res: Response) => {
  try {
    const repoSlug = String(req.params.repoSlug);
    const files = getAllCodeFiles(repoSlug);
    res.json(files);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to list files" });
  }
});

// GET /api/rcie/symbols/:repoSlug — Symbols for a specific file
router.get("/symbols/:repoSlug", (req: AuthRequest, res: Response) => {
  try {
    const repoSlug = String(req.params.repoSlug);
    const filePath = req.query.file as string;
    if (!filePath) {
      res.status(400).json({ error: "Missing ?file parameter" });
      return;
    }
    const symbols = getSymbolsForFile(repoSlug, filePath);
    res.json(symbols);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to get symbols" });
  }
});

// GET /api/rcie/deps/:repoSlug — Dependencies for a file
router.get("/deps/:repoSlug", (req: AuthRequest, res: Response) => {
  try {
    const repoSlug = String(req.params.repoSlug);
    const filePath = req.query.file as string;
    if (!filePath) {
      res.status(400).json({ error: "Missing ?file parameter" });
      return;
    }
    const direction = req.query.direction as string || "outgoing";
    const deps = direction === "incoming"
      ? getDependenciesTo(repoSlug, filePath)
      : getDependenciesFrom(repoSlug, filePath);
    res.json(deps);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to get dependencies" });
  }
});

// GET /api/rcie/guards/:repoSlug — Guards for a file
router.get("/guards/:repoSlug", (req: AuthRequest, res: Response) => {
  try {
    const repoSlug = String(req.params.repoSlug);
    const filePath = req.query.file as string;
    if (!filePath) {
      res.status(400).json({ error: "Missing ?file parameter" });
      return;
    }
    const guards = getGuardsForFile(repoSlug, filePath);
    res.json(guards);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to get guards" });
  }
});

// GET /api/rcie/annotations/:repoSlug — Annotations for a file
router.get("/annotations/:repoSlug", (req: AuthRequest, res: Response) => {
  try {
    const repoSlug = String(req.params.repoSlug);
    const filePath = req.query.file as string;
    if (!filePath) {
      res.status(400).json({ error: "Missing ?file parameter" });
      return;
    }
    const annotations = getAnnotationsForFile(repoSlug, filePath);
    res.json(annotations);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to get annotations" });
  }
});

// GET /api/rcie/summary/:repoSlug — AI summary for a file
router.get("/summary/:repoSlug", (req: AuthRequest, res: Response) => {
  try {
    const repoSlug = String(req.params.repoSlug);
    const filePath = req.query.file as string;
    if (!filePath) {
      res.status(400).json({ error: "Missing ?file parameter" });
      return;
    }
    const summary = getAISummary(repoSlug, filePath);
    res.json(summary || { message: "No AI summary available for this file" });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to get summary" });
  }
});

// GET /api/rcie/vulns/:repoSlug — Baseline vulnerabilities for a file
router.get("/vulns/:repoSlug", (req: AuthRequest, res: Response) => {
  try {
    const repoSlug = String(req.params.repoSlug);
    const filePath = req.query.file as string;
    if (!filePath) {
      res.status(400).json({ error: "Missing ?file parameter" });
      return;
    }
    const vulns = getBaselineVulnsForFile(repoSlug, filePath);
    res.json(vulns);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to get vulnerabilities" });
  }
});

// POST /api/rcie/vulns/:repoSlug/acknowledge — Acknowledge a baseline vuln
router.post("/vulns/:repoSlug/acknowledge", (req: AuthRequest, res: Response) => {
  try {
    const repoSlug = String(req.params.repoSlug);
    const { fingerprint } = req.body || {};
    if (!fingerprint || typeof fingerprint !== "string") {
      res.status(400).json({ error: "Missing fingerprint in request body" });
      return;
    }
    const updated = acknowledgeBaselineVuln(repoSlug, fingerprint);
    res.json({ acknowledged: updated });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to acknowledge vulnerability" });
  }
});

// POST /api/rcie/delta/:repoSlug — Resolve delta for a set of changed files (preview)
router.post("/delta/:repoSlug", (req: AuthRequest, res: Response) => {
  try {
    const repoSlug = String(req.params.repoSlug);
    const { files } = req.body || {};
    if (!Array.isArray(files) || files.length === 0) {
      res.status(400).json({ error: "Missing files array in request body" });
      return;
    }
    const sanitizedFiles = files.slice(0, 100).map((f: any) => ({
      filename: String(f.filename || ""),
      patch: typeof f.patch === "string" ? f.patch : "",
      additions: Number(f.additions) || 0,
      deletions: Number(f.deletions) || 0,
    }));
    const delta = resolveDelta(repoSlug, sanitizedFiles);
    // Convert Map to plain object for JSON serialization
    const fileContextsObj: Record<string, any> = {};
    for (const [k, v] of delta.fileContexts) {
      fileContextsObj[k] = v;
    }
    res.json({
      indexed: delta.indexed,
      fileContexts: fileContextsObj,
      baselineFingerprints: [...delta.baselineFingerprints],
      impactedFiles: delta.impactedFiles,
      promptEnrichment: delta.promptEnrichment,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Delta resolution failed" });
  }
});

export default router;
