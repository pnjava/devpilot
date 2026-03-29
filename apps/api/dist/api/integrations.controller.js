"use strict";
// ──────────────────────────────────────────────────────────────
// Integrations Controller – POST /api/integrations/sync,
//   GET /api/integrations/status
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
exports.IntegrationsController = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const sync_service_1 = require("../integrations/sync/sync.service");
const dto_1 = require("../common/dto");
const roles_decorator_1 = require("../auth/roles.decorator");
let IntegrationsController = class IntegrationsController {
    prisma;
    syncService;
    constructor(prisma, syncService) {
        this.prisma = prisma;
        this.syncService = syncService;
    }
    async getIntegrationStatus(filters) {
        const connections = await this.prisma.integrationConnection.findMany({
            orderBy: { createdAt: 'desc' },
        });
        const recentJobs = await this.prisma.syncJob.findMany({
            orderBy: { startedAt: 'desc' },
            take: 20,
        });
        return {
            data: {
                connections,
                recentJobs,
            },
        };
    }
    async triggerSync(body) {
        const orgId = body.orgId;
        const types = body.types ?? ['jira', 'bitbucket', 'wiki'];
        // Find integration connections for this org
        const connections = await this.prisma.integrationConnection.findMany({
            where: { organizationId: orgId, isActive: true },
        });
        const results = {};
        for (const conn of connections) {
            const connType = conn.type.toLowerCase();
            if (types.includes('jira') && connType === 'jira') {
                results.jira = await this.syncService.runJiraSync(conn.id);
            }
            if (types.includes('bitbucket') && connType === 'bitbucket') {
                results.bitbucket = await this.syncService.runBitbucketSync(conn.id);
            }
            if (types.includes('wiki') && connType === 'wiki') {
                results.wiki = await this.syncService.runWikiSync(conn.id);
            }
        }
        return { data: results };
    }
};
exports.IntegrationsController = IntegrationsController;
__decorate([
    (0, common_1.Get)('status'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.FilterQueryDto]),
    __metadata("design:returntype", Promise)
], IntegrationsController.prototype, "getIntegrationStatus", null);
__decorate([
    (0, common_1.Post)('sync'),
    (0, roles_decorator_1.Roles)('ADMIN', 'DELIVERY_PARTNER'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], IntegrationsController.prototype, "triggerSync", null);
exports.IntegrationsController = IntegrationsController = __decorate([
    (0, common_1.Controller)('integrations'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        sync_service_1.SyncService])
], IntegrationsController);
//# sourceMappingURL=integrations.controller.js.map