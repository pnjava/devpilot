"use strict";
// ──────────────────────────────────────────────────────────────
// Teams Controller – GET /api/teams, GET /api/teams/:id
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
exports.TeamsController = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const engine_service_1 = require("../metrics/engine.service");
const insights_service_1 = require("../metrics/insights.service");
const dto_1 = require("../common/dto");
let TeamsController = class TeamsController {
    prisma;
    metricsEngine;
    insights;
    constructor(prisma, metricsEngine, insights) {
        this.prisma = prisma;
        this.metricsEngine = metricsEngine;
        this.insights = insights;
    }
    async listTeams(filters) {
        const teams = await this.prisma.team.findMany({
            include: { _count: { select: { memberships: true, issues: true } } },
        });
        return { data: teams };
    }
    async getTeamDetail(id, filters) {
        const team = await this.prisma.team.findUnique({
            where: { id },
            include: {
                memberships: { include: { person: true } },
            },
        });
        if (!team)
            return { error: 'Team not found' };
        const periodStart = filters.dateFrom
            ? new Date(filters.dateFrom)
            : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const periodEnd = filters.dateTo ? new Date(filters.dateTo) : new Date();
        const metrics = await this.metricsEngine.computeTeamMetrics(id, periodStart, periodEnd);
        const narrativeInsights = metrics ? this.insights.generateTeamInsights(metrics) : [];
        // Aging stories
        const agingStories = await this.prisma.issue.findMany({
            where: {
                teamId: id,
                canonicalState: { in: ['IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'] },
            },
            orderBy: { updatedAt: 'asc' },
            take: 20,
        });
        return {
            data: {
                team,
                metrics,
                agingStories: agingStories.map((s) => ({
                    ...s,
                    ageDays: Math.round((Date.now() - s.updatedAt.getTime()) / (1000 * 60 * 60 * 24)),
                })),
                insights: narrativeInsights,
            },
        };
    }
};
exports.TeamsController = TeamsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.FilterQueryDto]),
    __metadata("design:returntype", Promise)
], TeamsController.prototype, "listTeams", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, dto_1.FilterQueryDto]),
    __metadata("design:returntype", Promise)
], TeamsController.prototype, "getTeamDetail", null);
exports.TeamsController = TeamsController = __decorate([
    (0, common_1.Controller)('teams'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        engine_service_1.MetricsEngineService,
        insights_service_1.InsightsService])
], TeamsController);
//# sourceMappingURL=teams.controller.js.map