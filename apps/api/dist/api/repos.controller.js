"use strict";
// ──────────────────────────────────────────────────────────────
// Repos Controller – GET /api/repos, GET /api/repos/:id
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
exports.ReposController = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const dto_1 = require("../common/dto");
let ReposController = class ReposController {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async listRepos(filters) {
        const repos = await this.prisma.repository.findMany({
            include: {
                _count: {
                    select: { branches: true, commits: true, pullRequests: true },
                },
            },
        });
        return { data: repos };
    }
    async getRepoDetail(id, filters) {
        const repo = await this.prisma.repository.findUnique({
            where: { id },
            include: {
                branches: { orderBy: { createdAt: 'desc' }, take: 20 },
            },
        });
        if (!repo)
            return { error: 'Repository not found' };
        const periodStart = filters.dateFrom
            ? new Date(filters.dateFrom)
            : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const periodEnd = filters.dateTo ? new Date(filters.dateTo) : new Date();
        const recentCommits = await this.prisma.commit.findMany({
            where: {
                repositoryId: id,
                timestamp: { gte: periodStart, lte: periodEnd },
            },
            orderBy: { timestamp: 'desc' },
            take: 50,
        });
        const openPRs = await this.prisma.pullRequest.findMany({
            where: {
                repositoryId: id,
                state: 'OPEN',
            },
            include: {
                author: true,
                reviews: { include: { reviewer: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
        const mergedPRs = await this.prisma.pullRequest.count({
            where: {
                repositoryId: id,
                state: 'MERGED',
                mergedAt: { gte: periodStart, lte: periodEnd },
            },
        });
        // Stale branches (no activity > 30 days)
        const staleCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const staleBranches = await this.prisma.branch.count({
            where: {
                repositoryId: id,
                createdAt: { lt: staleCutoff },
            },
        });
        return {
            data: {
                repo,
                recentCommits,
                openPRs,
                mergedPRCount: mergedPRs,
                staleBranchCount: staleBranches,
            },
        };
    }
};
exports.ReposController = ReposController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.FilterQueryDto]),
    __metadata("design:returntype", Promise)
], ReposController.prototype, "listRepos", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, dto_1.FilterQueryDto]),
    __metadata("design:returntype", Promise)
], ReposController.prototype, "getRepoDetail", null);
exports.ReposController = ReposController = __decorate([
    (0, common_1.Controller)('repos'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ReposController);
//# sourceMappingURL=repos.controller.js.map