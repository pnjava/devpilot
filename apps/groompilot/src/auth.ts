import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

// Read JWT_SECRET lazily — dotenv.config() runs after all require() calls are hoisted
function getJwtSecret(): string {
  return process.env.JWT_SECRET || "dev-secret-change-me";
}

export interface AuthUser {
  id: string;
  githubId: number;
  username: string;
  avatarUrl: string;
  accessToken: string;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export function signToken(user: AuthUser): string {
  return jwt.sign(
    { id: user.id, githubId: user.githubId, username: user.username },
    getJwtSecret(),
    { expiresIn: "7d" }
  );
}

export function verifyToken(token: string): AuthUser | null {
  try {
    return jwt.verify(token, getJwtSecret()) as AuthUser;
  } catch {
    return null;
  }
}

export function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "No token provided" });
    return;
  }
  const token = header.slice(7);
  const user = verifyToken(token);
  if (!user) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }
  req.user = user;
  next();
}
