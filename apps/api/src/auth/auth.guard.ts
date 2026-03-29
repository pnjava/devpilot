// ──────────────────────────────────────────────────────────────
// Simple Auth Guard (MVP)
// For MVP: passes through all requests. Replace with JWT/SSO.
// ──────────────────────────────────────────────────────────────

import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    // MVP: allow all requests. In production, validate JWT here.
    return true;
  }
}
