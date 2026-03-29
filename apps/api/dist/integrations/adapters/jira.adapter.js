"use strict";
// ──────────────────────────────────────────────────────────────
// Real Jira Adapter – delegates to @devpilot/jira shared client
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
var JiraAdapter_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.JiraAdapter = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const jira_1 = require("@devpilot/jira");
let JiraAdapter = JiraAdapter_1 = class JiraAdapter {
    prisma;
    logger = new common_1.Logger(JiraAdapter_1.name);
    client;
    constructor(prisma) {
        this.prisma = prisma;
        this.client = jira_1.JiraClient.fromEnv();
    }
    async testConnection() {
        try {
            const ok = await this.client.testConnection();
            if (!ok)
                this.logger.error('Jira connection test returned false');
            return ok;
        }
        catch (err) {
            this.logger.error('Jira connection failed', err);
            return false;
        }
    }
    async syncProjects() {
        const errors = [];
        let count = 0;
        try {
            const projects = await this.client.getProjects();
            for (const p of projects) {
                await this.prisma.project.upsert({
                    where: { key: p.key },
                    update: { name: p.name },
                    create: { key: p.key, name: p.name, externalId: p.id },
                });
                count++;
            }
        }
        catch (err) {
            errors.push(String(err));
        }
        return { itemsSynced: count, errors, hasMore: false };
    }
    async syncSprints(projectKey) {
        this.logger.log(`Syncing sprints for ${projectKey} – not yet implemented in real adapter`);
        return { itemsSynced: 0, errors: [], hasMore: false };
    }
    async syncIssues(options) {
        const errors = [];
        let count = 0;
        const jql = options.since
            ? `updated >= "${options.since.toISOString().slice(0, 10)}" ORDER BY updated ASC`
            : 'ORDER BY updated ASC';
        const startAt = options.cursor ? parseInt(options.cursor, 10) : 0;
        try {
            const data = await this.client.searchIssues(jql, {
                startAt,
                maxResults: 100,
                expand: 'changelog',
                fields: '*all',
            });
            for (const _raw of data.issues) {
                // Normalization would go here – map raw fields to Issue model
                count++;
            }
            const nextStart = data.startAt + data.maxResults;
            return {
                itemsSynced: count,
                errors,
                hasMore: nextStart < data.total,
                nextCursor: String(nextStart),
            };
        }
        catch (err) {
            errors.push(String(err));
            return { itemsSynced: count, errors, hasMore: false };
        }
    }
};
exports.JiraAdapter = JiraAdapter;
exports.JiraAdapter = JiraAdapter = JiraAdapter_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], JiraAdapter);
//# sourceMappingURL=jira.adapter.js.map