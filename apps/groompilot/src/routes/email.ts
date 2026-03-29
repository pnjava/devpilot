import { Router, Response } from "express";
import { AuthRequest } from "../auth";
import { sendEmail, formatGroomingSummaryHTML } from "../services/email";
import db from "../db";

const router = Router();

router.post("/send", async (req: AuthRequest, res: Response) => {
  try {
    const { sessionId, recipients } = req.body;
    if (!sessionId || !recipients?.length) {
      res.status(400).json({ error: "sessionId and recipients[] are required" });
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const email of recipients) {
      if (!emailRegex.test(email)) {
        res.status(400).json({ error: `Invalid email: ${email}` });
        return;
      }
    }

    const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as
      | { title: string; data: string }
      | undefined;
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const data = JSON.parse(session.data);
    const html = formatGroomingSummaryHTML({
      storyTitle: session.title,
      storyUrl: data.storyUrl || "#",
      scenarios: data.result?.scenarios || [],
      acceptanceCriteria: data.result?.acceptanceCriteria || [],
      testCases: data.result?.testCases || [],
      subtasks: data.result?.subtasks || [],
      spikes: data.result?.spikes || [],
    });

    const sent = await sendEmail({
      to: recipients,
      subject: `[GroomPilot] Grooming Summary: ${session.title}`,
      html,
      text: `Grooming summary for: ${session.title}`,
    });

    res.json({ sent, message: sent ? "Email sent" : "SMTP not configured - email not sent" });
  } catch (err) {
    console.error("Email error:", err);
    res.status(500).json({ error: "Failed to send email" });
  }
});

// Preview email HTML
router.post("/preview", async (req: AuthRequest, res: Response) => {
  try {
    const { sessionId } = req.body;
    const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as
      | { title: string; data: string }
      | undefined;
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const data = JSON.parse(session.data);
    const html = formatGroomingSummaryHTML({
      storyTitle: session.title,
      storyUrl: data.storyUrl || "#",
      scenarios: data.result?.scenarios || [],
      acceptanceCriteria: data.result?.acceptanceCriteria || [],
      testCases: data.result?.testCases || [],
      subtasks: data.result?.subtasks || [],
      spikes: data.result?.spikes || [],
    });

    res.json({ html });
  } catch (err) {
    console.error("Preview error:", err);
    res.status(500).json({ error: "Failed to generate preview" });
  }
});

export default router;
