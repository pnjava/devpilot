import { Router, Response } from "express";
import { AuthRequest } from "../auth";
import { complete, isAIEnabled, getProviderInfo } from "../services/ai-provider";

const router = Router();

// GET /api/ai/status — check if AI is configured and which provider is active
router.get("/status", (_req: AuthRequest, res: Response) => {
  const info = getProviderInfo();
  res.json({ enabled: isAIEnabled(), ...info });
});

// POST /api/ai/complete — send a prompt and get a completion (for testing / playground)
router.post("/complete", async (req: AuthRequest, res: Response) => {
  try {
    if (!isAIEnabled()) {
      res.status(503).json({
        error: "No AI provider configured. Set AI_PROVIDER in .env (ollama | openai | github-models)",
      });
      return;
    }

    const { prompt, system, temperature, maxTokens } = req.body;
    if (!prompt) {
      res.status(400).json({ error: "prompt is required" });
      return;
    }

    const result = await complete({
      messages: [
        ...(system ? [{ role: "system" as const, content: system }] : []),
        { role: "user" as const, content: prompt },
      ],
      temperature: temperature ?? 0.3,
      maxTokens: maxTokens ?? 1024,
    });

    res.json(result);
  } catch (err: any) {
    console.error("AI completion error:", err);
    res.status(500).json({ error: err.message || "AI completion failed" });
  }
});

export default router;
