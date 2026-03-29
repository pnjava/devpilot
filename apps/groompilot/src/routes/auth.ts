import { Router, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import db from "../db";
import { AuthRequest, signToken } from "../auth";

const router = Router();

// Read env vars lazily (inside handlers) because dotenv.config() runs
// after all CommonJS require() calls are hoisted during TS compilation.

// Step 1: redirect to GitHub (no redirect_uri — uses OAuth App's configured callback URL)
router.get("/github", (_req, res: Response) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    res.status(500).json({ error: "GITHUB_CLIENT_ID not configured" });
    return;
  }
  const redirect = `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=repo,read:user,user:email`;
  res.json({ url: redirect });
});

// Step 2a: GET callback — GitHub redirects here, then we forward to the frontend
router.get("/github/callback", (req, res: Response) => {
  const code = req.query.code as string;
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  if (!code) {
    res.redirect(`${frontendUrl}/login?error=no_code`);
    return;
  }
  res.redirect(`${frontendUrl}/auth/callback?code=${code}`);
});

// Step 2b: POST callback — frontend sends code here to exchange for JWT
router.post("/github/callback", async (req: AuthRequest, res: Response) => {
  const { code } = req.body;
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!code || !clientId || !clientSecret) {
    res.status(400).json({ error: "Missing code or GitHub OAuth config" });
    return;
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });
    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string; error_description?: string };
    console.log("GitHub token response:", { status: tokenRes.status, error: tokenData.error, hasToken: !!tokenData.access_token });
    if (!tokenData.access_token) {
      res.status(400).json({ error: tokenData.error_description || tokenData.error || "Failed to get access token from GitHub" });
      return;
    }

    // Get user info
    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userRes.ok) {
      const errBody = await userRes.text();
      console.error("GitHub user fetch failed:", userRes.status, errBody);
      res.status(400).json({ error: `GitHub user API failed: ${userRes.status}` });
      return;
    }
    const userData = (await userRes.json()) as {
      id: number;
      login: string;
      avatar_url: string;
    };
    if (!userData.id) {
      res.status(400).json({ error: "GitHub user data missing id" });
      return;
    }

    // Upsert user
    const userId = uuidv4();
    const existingUser = db
      .prepare("SELECT id FROM users WHERE github_id = ?")
      .get(userData.id) as { id: string } | undefined;

    if (existingUser) {
      db.prepare("UPDATE users SET access_token = ?, username = ?, avatar_url = ? WHERE github_id = ?")
        .run(tokenData.access_token, userData.login, userData.avatar_url, userData.id);
    } else {
      db.prepare("INSERT INTO users (id, github_id, username, avatar_url, access_token) VALUES (?, ?, ?, ?, ?)")
        .run(userId, userData.id, userData.login, userData.avatar_url, tokenData.access_token);
    }

    const finalUserId = existingUser?.id || userId;
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(finalUserId) as {
      id: string; github_id: number; username: string; avatar_url: string; access_token: string;
    };

    const jwt = signToken({
      id: user.id,
      githubId: user.github_id,
      username: user.username,
      avatarUrl: user.avatar_url,
      accessToken: user.access_token,
    });

    res.json({
      token: jwt,
      user: {
        id: user.id,
        username: user.username,
        avatarUrl: user.avatar_url,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("OAuth error:", msg, err);
    res.status(500).json({ error: `Auth failed: ${msg}` });
  }
});

// Get current user — auth routes are public so we verify the token manually here
router.get("/me", (req: AuthRequest, res: Response) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const { verifyToken } = require("../auth");
  const decoded = verifyToken(header.slice(7));
  if (!decoded) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }
  const user = db.prepare("SELECT id, username, avatar_url FROM users WHERE id = ?").get(decoded.id) as
    | { id: string; username: string; avatar_url: string }
    | undefined;
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  res.json({
    id: user.id,
    username: user.username,
    avatarUrl: user.avatar_url,
  });
});

// Dev login — bypasses GitHub OAuth; uses existing user in DB
router.post("/dev-login", (_req, res: Response) => {
  const user = db.prepare("SELECT * FROM users LIMIT 1").get() as
    | { id: string; github_id: number; username: string; avatar_url: string; access_token: string }
    | undefined;
  if (!user) {
    res.status(404).json({ error: "No user in DB. Run GitHub OAuth at least once first." });
    return;
  }
  const jwt = signToken({
    id: user.id,
    githubId: user.github_id,
    username: user.username,
    avatarUrl: user.avatar_url,
    accessToken: user.access_token,
  });
  res.json({
    token: jwt,
    user: {
      id: user.id,
      username: user.username,
      avatarUrl: user.avatar_url,
    },
  });
});

export default router;
