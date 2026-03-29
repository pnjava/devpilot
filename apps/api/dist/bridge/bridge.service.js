"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var BridgeService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BridgeService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
/**
 * Bridge Service – Connects PIDI delivery metrics with GroomPilot grooming
 * and review data. Enables:
 *   - Story readiness fed by live review metrics
 *   - Grooming sessions linked to PIDI issues via StoryGroomLink
 *   - PR review findings surfaced in delivery dashboards
 *   - Knowledge warehouse docs linked to traceability chains
 */
let BridgeService = BridgeService_1 = class BridgeService {
    prisma;
    logger = new common_1.Logger(BridgeService_1.name);
    constructor(prisma) {
        this.prisma = prisma;
    }
    // ── Story → Grooming Links ────────────────────────────────
    /** Link a PIDI issue to a grooming session */
    async linkStoryToSession(issueId, sessionId, linkType = 'groomed') {
        return this.prisma.storyGroomLink.upsert({
            where: { issueId_sessionId: { issueId, sessionId } },
            create: { issueId, sessionId, linkType },
            update: { linkType },
        });
    }
    /** Get all grooming sessions for a PIDI issue */
    async getGroomSessionsForStory(issueKey) {
        const issue = await this.prisma.issue.findUnique({
            where: { issueKey },
            include: {
                storyGroomLinks: {
                    include: { session: true },
                    orderBy: { createdAt: 'desc' },
                },
            },
        });
        return issue?.storyGroomLinks ?? [];
    }
    // ── Review Metrics for Delivery Dashboard ─────────────────
    /** Aggregate review run stats for a repo (last N days) */
    async getReviewMetrics(repoSlug, days = 30) {
        const since = new Date();
        since.setDate(since.getDate() - days);
        const runs = await this.prisma.reviewRun.findMany({
            where: { repoSlug, completedAt: { gte: since } },
            select: {
                riskScore: true,
                totalFindings: true,
                blockers: true,
                warnings: true,
                durationMs: true,
                changeType: true,
                verdict: true,
            },
        });
        if (runs.length === 0)
            return null;
        const avgRiskScore = runs.reduce((sum, r) => sum + r.riskScore, 0) / runs.length;
        const totalBlockers = runs.reduce((sum, r) => sum + r.blockers, 0);
        const totalWarnings = runs.reduce((sum, r) => sum + r.warnings, 0);
        const avgDuration = runs.reduce((sum, r) => sum + r.durationMs, 0) / runs.length;
        return {
            reviewCount: runs.length,
            avgRiskScore: Math.round(avgRiskScore * 10) / 10,
            totalBlockers,
            totalWarnings,
            avgDurationMs: Math.round(avgDuration),
            verdictBreakdown: runs.reduce((acc, r) => {
                acc[r.verdict] = (acc[r.verdict] || 0) + 1;
                return acc;
            }, {}),
        };
    }
    // ── Knowledge → Traceability ──────────────────────────────
    /** Get knowledge docs linked to a Jira issue */
    async getKnowledgeForIssue(issueKey) {
        const links = await this.prisma.knowledgeJiraLink.findMany({
            where: { jiraKey: issueKey },
            include: {
                document: {
                    include: { facts: true, tags: true },
                },
            },
            orderBy: { confidence: 'desc' },
        });
        return links;
    }
    // ── BPE Insights for Team Dashboard ───────────────────────
    /** Get active behavioral patterns for a repo */
    async getActivePatternsForRepo(repoSlug) {
        return this.prisma.bpePattern.findMany({
            where: { repoSlug, enabled: true },
            orderBy: { confidence: 'desc' },
        });
    }
    // ── RCIE Code Intelligence for Review ─────────────────────
    /** Get code intelligence summary for a repo */
    async getCodeIntelligenceSummary(repoSlug) {
        const [fileCount, symbolCount, graphNodeCount, lastRun] = await Promise.all([
            this.prisma.repoCodeFile.count({ where: { repoSlug } }),
            this.prisma.repoCodeSymbol.count({ where: { repoSlug } }),
            this.prisma.repoCodeGraphNode.count({ where: { repoSlug } }),
            this.prisma.repoIndexRun.findFirst({
                where: { repoSlug, status: 'completed' },
                orderBy: { completedAt: 'desc' },
            }),
        ]);
        return {
            fileCount,
            symbolCount,
            graphNodeCount,
            lastIndexedAt: lastRun?.completedAt ?? null,
            lastDurationMs: lastRun?.durationMs ?? null,
        };
    }
};
exports.BridgeService = BridgeService;
exports.BridgeService = BridgeService = BridgeService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], BridgeService);
//# sourceMappingURL=bridge.service.js.map