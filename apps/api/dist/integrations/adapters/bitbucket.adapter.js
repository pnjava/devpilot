"use strict";
// ──────────────────────────────────────────────────────────────
// Real Bitbucket Adapter (skeleton – Bitbucket Cloud REST API 2.0)
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
var BitbucketAdapter_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BitbucketAdapter = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("../../prisma/prisma.service");
let BitbucketAdapter = BitbucketAdapter_1 = class BitbucketAdapter {
    config;
    prisma;
    logger = new common_1.Logger(BitbucketAdapter_1.name);
    baseUrl;
    workspace;
    authHeader;
    constructor(config, prisma) {
        this.config = config;
        this.prisma = prisma;
        this.baseUrl = this.config.getOrThrow('BITBUCKET_BASE_URL');
        this.workspace = this.config.getOrThrow('BITBUCKET_WORKSPACE');
        const user = this.config.getOrThrow('BITBUCKET_USERNAME');
        const pass = this.config.getOrThrow('BITBUCKET_APP_PASSWORD');
        this.authHeader = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
    }
    async bbFetch(path) {
        const url = `${this.baseUrl}${path}`;
        const res = await fetch(url, {
            headers: { Authorization: this.authHeader, Accept: 'application/json' },
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Bitbucket API error ${res.status}: ${body}`);
        }
        return res.json();
    }
    async testConnection() {
        try {
            await this.bbFetch(`/repositories/${this.workspace}?pagelen=1`);
            return true;
        }
        catch (err) {
            this.logger.error('Bitbucket connection failed', err);
            return false;
        }
    }
    async syncRepositories(_options) {
        this.logger.log('Syncing Bitbucket repos – skeleton');
        return { itemsSynced: 0, errors: [], hasMore: false };
    }
    async syncCommits(_repoSlug, _options) {
        return { itemsSynced: 0, errors: [], hasMore: false };
    }
    async syncPullRequests(_repoSlug, _options) {
        return { itemsSynced: 0, errors: [], hasMore: false };
    }
    async syncBranches(_repoSlug) {
        return { itemsSynced: 0, errors: [], hasMore: false };
    }
};
exports.BitbucketAdapter = BitbucketAdapter;
exports.BitbucketAdapter = BitbucketAdapter = BitbucketAdapter_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        prisma_service_1.PrismaService])
], BitbucketAdapter);
//# sourceMappingURL=bitbucket.adapter.js.map