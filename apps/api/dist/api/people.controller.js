"use strict";
// ──────────────────────────────────────────────────────────────
// People Controller – GET /api/people, GET /api/people/:id
// Non-surveillance: shows review/doc/collaboration contributions,
// NOT individual commit counts or per-person velocity.
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
exports.PeopleController = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const dto_1 = require("../common/dto");
let PeopleController = class PeopleController {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async listPeople(filters) {
        const people = await this.prisma.person.findMany({
            include: {
                memberships: { include: { team: true } },
                _count: {
                    select: {
                        assignedIssues: true,
                        reportedIssues: true,
                        prReviews: true,
                        wikiEdits: true,
                    },
                },
            },
        });
        return { data: people };
    }
    async getPersonDetail(id, filters) {
        const person = await this.prisma.person.findUnique({
            where: { id },
            include: {
                memberships: { include: { team: true } },
            },
        });
        if (!person)
            return { error: 'Person not found' };
        const periodStart = filters.dateFrom
            ? new Date(filters.dateFrom)
            : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const periodEnd = filters.dateTo ? new Date(filters.dateTo) : new Date();
        // Collaboration-focused metrics (not surveillance)
        const reviewsGiven = await this.prisma.pullRequestReview.count({
            where: {
                reviewerId: id,
                createdAt: { gte: periodStart, lte: periodEnd },
            },
        });
        const wikiEdits = await this.prisma.wikiEdit.count({
            where: {
                editorId: id,
                timestamp: { gte: periodStart, lte: periodEnd },
            },
        });
        const prComments = await this.prisma.pullRequestComment.count({
            where: {
                authorId: id,
                createdAt: { gte: periodStart, lte: periodEnd },
            },
        });
        const storiesCompleted = await this.prisma.issue.count({
            where: {
                assigneeId: id,
                canonicalState: 'DONE',
                resolvedAt: { gte: periodStart, lte: periodEnd },
            },
        });
        const storiesAssigned = await this.prisma.issue.findMany({
            where: {
                assigneeId: id,
                canonicalState: { in: ['IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'] },
            },
            select: { id: true, issueKey: true, summary: true, canonicalState: true, updatedAt: true },
        });
        return {
            data: {
                person,
                contributions: {
                    reviewsGiven,
                    wikiEdits,
                    prComments,
                    storiesCompleted,
                },
                currentWork: storiesAssigned,
            },
        };
    }
};
exports.PeopleController = PeopleController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.FilterQueryDto]),
    __metadata("design:returntype", Promise)
], PeopleController.prototype, "listPeople", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, dto_1.FilterQueryDto]),
    __metadata("design:returntype", Promise)
], PeopleController.prototype, "getPersonDetail", null);
exports.PeopleController = PeopleController = __decorate([
    (0, common_1.Controller)('people'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PeopleController);
//# sourceMappingURL=people.controller.js.map