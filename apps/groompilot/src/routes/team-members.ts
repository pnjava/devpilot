import { Router, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import db from "../db";
import { AuthRequest } from "../auth";

const router = Router();

// GET /api/team-members — list all members
router.get("/", (_req: AuthRequest, res: Response) => {
  try {
    const members = db
      .prepare("SELECT * FROM team_members ORDER BY display_name ASC")
      .all();
    res.json(members);
  } catch (err) {
    console.error("team-members list error:", err);
    res.status(500).json({ error: "Failed to fetch team members" });
  }
});

// POST /api/team-members — add a new member
router.post("/", (req: AuthRequest, res: Response) => {
  try {
    const { display_name, email, bitbucket_name, organisation } = req.body as {
      display_name: string;
      email: string;
      bitbucket_name?: string;
      organisation?: string;
    };

    if (!display_name || !email) {
      res.status(400).json({ error: "display_name and email are required" });
      return;
    }

    const id = `tm-${uuidv4().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO team_members (id, display_name, email, bitbucket_name, organisation)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, display_name.trim(), email.trim().toLowerCase(), bitbucket_name?.trim() ?? null, organisation?.trim() ?? "aciworldwide");

    const created = db.prepare("SELECT * FROM team_members WHERE id = ?").get(id);
    res.status(201).json(created);
  } catch (err: any) {
    if (err?.message?.includes("UNIQUE constraint failed")) {
      res.status(409).json({ error: "A member with that email already exists" });
      return;
    }
    console.error("team-members create error:", err);
    res.status(500).json({ error: "Failed to create team member" });
  }
});

// PUT /api/team-members/:id — update a member
router.put("/:id", (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const { display_name, email, bitbucket_name, organisation, active } = req.body as {
      display_name?: string;
      email?: string;
      bitbucket_name?: string;
      organisation?: string;
      active?: boolean;
    };

    const existing = db
      .prepare("SELECT * FROM team_members WHERE id = ?")
      .get(id) as any;
    if (!existing) {
      res.status(404).json({ error: "Team member not found" });
      return;
    }

    db.prepare(
      `UPDATE team_members
       SET display_name  = ?,
           email         = ?,
           bitbucket_name = ?,
           organisation  = ?,
           active        = ?,
           updated_at    = datetime('now')
       WHERE id = ?`
    ).run(
      (display_name ?? existing.display_name).trim(),
      (email ?? existing.email).trim().toLowerCase(),
      (bitbucket_name ?? existing.bitbucket_name)?.trim() ?? null,
      (organisation ?? existing.organisation).trim(),
      active !== undefined ? (active ? 1 : 0) : existing.active,
      id
    );

    const updated = db.prepare("SELECT * FROM team_members WHERE id = ?").get(id);
    res.json(updated);
  } catch (err: any) {
    if (err?.message?.includes("UNIQUE constraint failed")) {
      res.status(409).json({ error: "A member with that email already exists" });
      return;
    }
    console.error("team-members update error:", err);
    res.status(500).json({ error: "Failed to update team member" });
  }
});

// DELETE /api/team-members/:id — remove a member
router.delete("/:id", (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const result = db
      .prepare("DELETE FROM team_members WHERE id = ?")
      .run(id);
    if (result.changes === 0) {
      res.status(404).json({ error: "Team member not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("team-members delete error:", err);
    res.status(500).json({ error: "Failed to delete team member" });
  }
});

export default router;
