"use strict";
// ──────────────────────────────────────────────────────────────
// Stories Controller – GET /api/stories/:issueKey
// ──────────────────────────────────────────────────────────────
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StoriesController = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const engine_service_1 = require("../metrics/engine.service");
const insights_service_1 = require("../metrics/insights.service");
let StoriesController = class StoriesController {
    prisma;
    metricsEngine;
    insights;
    constructor(prisma, metricsEngine, insights) {
        this.prisma = prisma;
        this.metricsEngine = metricsEngine;
        this.insights = insights;
    }
    async getStoryDetail(issueKey) {
        const issue = await this.prisma.issue.findFirst({
            where: { issueKey },
            include: {
                events: { orderBy: { timestamp: 'asc' } },
                comments: { orderBy: { createdAt: 'asc' } },
                assignee: true,
                reporter: true,
                sprint: true,
                team: true,
            },
        });
        if (!issue)
            return { error: 'Story not found' };
        const metrics = await this.metricsEngine.computeStoryMetrics(issueKey);
        const narrativeInsights = metrics ? this.insights.generateStoryInsight(metrics) : [];
        // Linked artifacts
        const links = await this.prisma.artifactLink.findMany({
            where: { issueId: issue.id },
            orderBy: { createdAt: 'desc' },
        });
        // Build timeline from events + comments + links
        const timeline = [
            ...issue.events.map((e) => ({
                type: 'transition',
                timestamp: e.timestamp,
                summary: `${e.field}: ${e.fromValue ?? '(none)'} → ${e.toValue ?? '(none)'}`,
                actor: e.authorId,
            })),
            ...issue.comments.map((c) => ({
                type: 'comment',
                timestamp: c.createdAt,
                summary: c.body.slice(0, 200),
                actor: c.authorId,
            })),
            ...links.map((l) => ({
                type: 'link',
                timestamp: l.createdAt,
                summary: `${l.artifactType} linked via ${l.method} (confidence: ${l.confidence})`,
                actor: null,
            })),
        ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        // Manual annotations
        const annotations = await this.prisma.manualAnnotation.findMany({
            where: { issueId: issue.id },
            include: { author: true },
            orderBy: { createdAt: 'desc' },
        });
        return {
            data: {
                issue,
                metrics,
                timeline,
                linkedArtifacts: links,
                annotations,
                insights: narrativeInsights,
            },
        };
    }
};
exports.StoriesController = StoriesController;
__decorate([
    (0, common_1.Get)(':issueKey'),
    __param(0, (0, common_1.Param)('issueKey')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], StoriesController.prototype, "getStoryDetail", null);
exports.StoriesController = StoriesController = __decorate([
    (0, common_1.Controller)('stories'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        engine_service_1.MetricsEngineService,
        insights_service_1.InsightsService])
], StoriesController);
//# sourceMappingURL=stories.controller.js.map