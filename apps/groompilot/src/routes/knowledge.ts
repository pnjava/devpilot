import { Router, Response } from "express";
import { AuthRequest } from "../auth";
import db from "../db";
import { ingestKnowledgePackFile, getKnowledgeContextForJira } from "../services/knowledge-warehouse";

const router = Router();

router.post("/ingest-pack", async (req: AuthRequest, res: Response) => {
  try {
    const { filePath, sourceType, jiraKey } = req.body || {};
    if (!filePath || typeof filePath !== "string") {
      res.status(400).json({ error: "filePath is required" });
      return;
    }

    const result = ingestKnowledgePackFile(filePath, {
      sourceType: sourceType || "confluence",
      jiraKey,
    });

    res.json({ ok: true, result });
  } catch (err) {
    console.error("knowledge ingest-pack error:", err);
    res.status(500).json({ error: "Failed to ingest knowledge pack" });
  }
});

router.get("/context", async (req: AuthRequest, res: Response) => {
  try {
    const jiraKey = String(req.query.jiraKey || "").trim();
    if (!jiraKey) {
      res.status(400).json({ error: "jiraKey is required" });
      return;
    }
    const limit = Math.max(1, Math.min(Number(req.query.limit || 20), 200));
    const context = getKnowledgeContextForJira(jiraKey, limit);
    res.json(context);
  } catch (err) {
    console.error("knowledge context error:", err);
    res.status(500).json({ error: "Failed to load knowledge context" });
  }
});

router.post("/link-jira", async (req: AuthRequest, res: Response) => {
  try {
    const { jiraKey, documentIds, confidence, source } = req.body || {};
    if (!jiraKey || !Array.isArray(documentIds) || documentIds.length === 0) {
      res.status(400).json({ error: "jiraKey and non-empty documentIds are required" });
      return;
    }

    const key = String(jiraKey).toUpperCase().trim();
    const conf = Number.isFinite(Number(confidence)) ? Number(confidence) : 0.7;
    const src = String(source || "manual");

    const stmt = db.prepare(
      "INSERT OR IGNORE INTO knowledge_jira_links (jira_key, document_id, confidence, source) VALUES (?, ?, ?, ?)"
    );

    const tx = db.transaction((ids: string[]) => {
      for (const id of ids) stmt.run(key, String(id), conf, src);
    });

    tx(documentIds.map((x: any) => String(x)));

    res.json({ ok: true, jiraKey: key, linkedCount: documentIds.length });
  } catch (err) {
    console.error("knowledge link-jira error:", err);
    res.status(500).json({ error: "Failed to link Jira to documents" });
  }
});

router.get("/documents", async (req: AuthRequest, res: Response) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 200));

    if (!q) {
      const docs = db.prepare(
        "SELECT id, title, url, source_space as sourceSpace, source_type as sourceType, updated_at as updatedAt FROM knowledge_documents ORDER BY updated_at DESC LIMIT ?"
      ).all(limit);
      res.json({ count: docs.length, documents: docs });
      return;
    }

    const like = `%${q}%`;
    const docs = db.prepare(`
      SELECT DISTINCT d.id, d.title, d.url, d.source_space as sourceSpace, d.source_type as sourceType, d.updated_at as updatedAt
      FROM knowledge_documents d
      LEFT JOIN knowledge_facts f ON f.document_id = d.id
      WHERE d.title LIKE ? OR d.body_excerpt LIKE ? OR f.content LIKE ?
      ORDER BY d.updated_at DESC
      LIMIT ?
    `).all(like, like, like, limit);

    res.json({ count: docs.length, documents: docs });
  } catch (err) {
    console.error("knowledge documents error:", err);
    res.status(500).json({ error: "Failed to load knowledge documents" });
  }
});

export default router;
