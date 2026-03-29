"use strict";
// ──────────────────────────────────────────────────────────────
// Overview Controller – GET /api/overview
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
exports.OverviewController = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const engine_service_1 = require("../metrics/engine.service");
const insights_service_1 = require("../metrics/insights.service");
const dto_1 = require("../common/dto");
let OverviewController = class OverviewController {
    prisma;
    metricsEngine;
    insights;
    constructor(prisma, metricsEngine, insights) {
        this.prisma = prisma;
        this.metricsEngine = metricsEngine;
        this.insights = insights;
    }
    async getOverview(filters) {
        const teams = await this.prisma.team.findMany({
            where: filters.teamId ? { id: filters.teamId } : undefined,
        });
        const periodStart = filters.dateFrom ? new Date(filters.dateFrom) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const periodEnd = filters.dateTo ? new Date(filters.dateTo) : new Date();
        const teamRiskScores = [];
        const allInsights = [];
        let overallHealthIndex = 0;
        const overallHealthFactors = {};
        for (const team of teams) {
            const metrics = await this.metricsEngine.computeTeamMetrics(team.id, periodStart, periodEnd);
            if (metrics) {
                teamRiskScores.push({
                    teamId: team.id,
                    teamName: team.name,
                    riskScore: metrics.teamRiskScore,
                });
                overallHealthIndex += metrics.deliveryHealthIndex;
                const teamInsights = this.insights.generateTeamInsights(metrics);
                allInsights.push(...teamInsights);
            }
        }
        if (teams.length > 0) {
            overallHealthIndex = Math.round(overallHealthIndex / teams.length);
        }
        // Top risk stories
        const topRiskStories = await this.prisma.issue.findMany({
            where: {
                canonicalState: { in: ['IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'] },
                ...(filters.teamId ? { teamId: filters.teamId } : {}),
            },
            orderBy: { updatedAt: 'asc' },
            take: 10,
        });
        // Recent alerts
        const recentAlerts = await this.prisma.alert.findMany({
            where: { isActive: true },
            orderBy: { createdAt: 'desc' },
            take: 10,
        });
        return {
            data: {
                deliveryHealthIndex: overallHealthIndex,
                deliveryHealthFactors: overallHealthFactors,
                teamRiskScores,
                topRiskStories,
                teamsNeedingAttention: teamRiskScores
                    .filter((t) => t.riskScore > 50)
                    .map((t) => ({
                    teamId: t.teamId,
                    teamName: t.teamName,
                    reasons: ['High risk score'],
                })),
                recentAlerts,
                insights: allInsights,
            },
        };
    }
};
exports.OverviewController = OverviewController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.FilterQueryDto]),
    __metadata("design:returntype", Promise)
], OverviewController.prototype, "getOverview", null);
exports.OverviewController = OverviewController = __decorate([
    (0, common_1.Controller)('overview'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        engine_service_1.MetricsEngineService,
        insights_service_1.InsightsService])
], OverviewController);
//# sourceMappingURL=overview.controller.js.map