"use strict";
// ──────────────────────────────────────────────────────────────
// Sync Service – orchestrates full/incremental sync jobs
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
var SyncService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const adapter_interface_1 = require("../adapters/adapter.interface");
let SyncService = SyncService_1 = class SyncService {
    prisma;
    jira;
    bitbucket;
    wiki;
    logger = new common_1.Logger(SyncService_1.name);
    constructor(prisma, jira, bitbucket, wiki) {
        this.prisma = prisma;
        this.jira = jira;
        this.bitbucket = bitbucket;
        this.wiki = wiki;
    }
    async runJiraSync(connectionId, full = false) {
        const job = await this.prisma.syncJob.create({
            data: { connectionId, type: full ? 'FULL' : 'INCREMENTAL', status: 'RUNNING' },
        });
        try {
            const projResult = await this.jira.syncProjects();
            const issueResult = await this.jira.syncIssues({ fullSync: full });
            const total = projResult.itemsSynced + issueResult.itemsSynced;
            const errors = [...projResult.errors, ...issueResult.errors];
            await this.prisma.syncJob.update({
                where: { id: job.id },
                data: {
                    status: errors.length > 0 ? 'PARTIAL' : 'COMPLETED',
                    completedAt: new Date(),
                    itemsSynced: total,
                    errors,
                    cursor: issueResult.nextCursor,
                },
            });
            await this.prisma.integrationConnection.update({
                where: { id: connectionId },
                data: {
                    lastSyncAt: new Date(),
                    lastSyncStatus: errors.length > 0 ? 'PARTIAL' : 'COMPLETED',
                },
            });
            this.logger.log(`Jira sync complete: ${total} items, ${errors.length} errors`);
        }
        catch (err) {
            await this.prisma.syncJob.update({
                where: { id: job.id },
                data: { status: 'FAILED', completedAt: new Date(), errors: [String(err)] },
            });
            this.logger.error('Jira sync failed', err);
        }
    }
    async runBitbucketSync(connectionId, full = false) {
        const job = await this.prisma.syncJob.create({
            data: { connectionId, type: full ? 'FULL' : 'INCREMENTAL', status: 'RUNNING' },
        });
        try {
            const result = await this.bitbucket.syncRepositories({ fullSync: full });
            await this.prisma.syncJob.update({
                where: { id: job.id },
                data: {
                    status: result.errors.length > 0 ? 'PARTIAL' : 'COMPLETED',
                    completedAt: new Date(),
                    itemsSynced: result.itemsSynced,
                    errors: result.errors,
                },
            });
            this.logger.log(`Bitbucket sync complete: ${result.itemsSynced} items`);
        }
        catch (err) {
            await this.prisma.syncJob.update({
                where: { id: job.id },
                data: { status: 'FAILED', completedAt: new Date(), errors: [String(err)] },
            });
            this.logger.error('Bitbucket sync failed', err);
        }
    }
    async runWikiSync(connectionId, full = false) {
        const job = await this.prisma.syncJob.create({
            data: { connectionId, type: full ? 'FULL' : 'INCREMENTAL', status: 'RUNNING' },
        });
        try {
            const result = await this.wiki.syncPages({ fullSync: full });
            await this.prisma.syncJob.update({
                where: { id: job.id },
                data: {
                    status: result.errors.length > 0 ? 'PARTIAL' : 'COMPLETED',
                    completedAt: new Date(),
                    itemsSynced: result.itemsSynced,
                    errors: result.errors,
                },
            });
            this.logger.log(`Wiki sync complete: ${result.itemsSynced} items`);
        }
        catch (err) {
            await this.prisma.syncJob.update({
                where: { id: job.id },
                data: { status: 'FAILED', completedAt: new Date(), errors: [String(err)] },
            });
            this.logger.error('Wiki sync failed', err);
        }
    }
};
exports.SyncService = SyncService;
exports.SyncService = SyncService = SyncService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)(adapter_interface_1.JIRA_ADAPTER)),
    __param(2, (0, common_1.Inject)(adapter_interface_1.BITBUCKET_ADAPTER)),
    __param(3, (0, common_1.Inject)(adapter_interface_1.WIKI_ADAPTER)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, Object, Object, Object])
], SyncService);
//# sourceMappingURL=sync.service.js.map