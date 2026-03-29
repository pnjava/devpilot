"use strict";
// ──────────────────────────────────────────────────────────────
// Mock Bitbucket Adapter
// ──────────────────────────────────────────────────────────────
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var BitbucketMockAdapter_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BitbucketMockAdapter = void 0;
const common_1 = require("@nestjs/common");
let BitbucketMockAdapter = BitbucketMockAdapter_1 = class BitbucketMockAdapter {
    logger = new common_1.Logger(BitbucketMockAdapter_1.name);
    async testConnection() {
        this.logger.log('Mock Bitbucket: connection OK');
        return true;
    }
    async syncRepositories(_options) {
        this.logger.log('Mock Bitbucket: repos created via seed');
        return { itemsSynced: 0, errors: [], hasMore: false };
    }
    async syncCommits(_repoSlug, _options) {
        this.logger.log('Mock Bitbucket: commits created via seed');
        return { itemsSynced: 0, errors: [], hasMore: false };
    }
    async syncPullRequests(_repoSlug, _options) {
        this.logger.log('Mock Bitbucket: PRs created via seed');
        return { itemsSynced: 0, errors: [], hasMore: false };
    }
    async syncBranches(_repoSlug) {
        this.logger.log('Mock Bitbucket: branches created via seed');
        return { itemsSynced: 0, errors: [], hasMore: false };
    }
};
exports.BitbucketMockAdapter = BitbucketMockAdapter;
exports.BitbucketMockAdapter = BitbucketMockAdapter = BitbucketMockAdapter_1 = __decorate([
    (0, common_1.Injectable)()
], BitbucketMockAdapter);
//# sourceMappingURL=bitbucket-mock.adapter.js.map