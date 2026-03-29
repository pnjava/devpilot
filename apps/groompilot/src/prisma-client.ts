// ──────────────────────────────────────────────────────────────
// DevPilot – Prisma client adapter for GroomPilot services
//
// New code and bridge services should import { prisma } from "./prisma-client"
// Existing SQLite-based services will migrate incrementally.
// ──────────────────────────────────────────────────────────────
import { PrismaClient } from '@devpilot/db';

const prisma = new PrismaClient();

export default prisma;
export { prisma };
