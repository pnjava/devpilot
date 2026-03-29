"use strict";
// ──────────────────────────────────────────────────────────────
// Real Wiki / Confluence Adapter (skeleton)
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
var WikiAdapter_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WikiAdapter = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
let WikiAdapter = WikiAdapter_1 = class WikiAdapter {
    config;
    logger = new common_1.Logger(WikiAdapter_1.name);
    baseUrl;
    authHeader;
    constructor(config) {
        this.config = config;
        this.baseUrl = this.config.getOrThrow('WIKI_BASE_URL');
        const email = this.config.getOrThrow('WIKI_EMAIL');
        const token = this.config.getOrThrow('WIKI_API_TOKEN');
        this.authHeader = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
    }
    async testConnection() {
        try {
            const res = await fetch(`${this.baseUrl}/rest/api/space?limit=1`, {
                headers: { Authorization: this.authHeader, Accept: 'application/json' },
            });
            return res.ok;
        }
        catch (err) {
            this.logger.error('Wiki connection failed', err);
            return false;
        }
    }
    async syncPages(_options) {
        this.logger.log('Wiki sync – skeleton');
        return { itemsSynced: 0, errors: [], hasMore: false };
    }
    async syncEdits(_pageId) {
        return { itemsSynced: 0, errors: [], hasMore: false };
    }
};
exports.WikiAdapter = WikiAdapter;
exports.WikiAdapter = WikiAdapter = WikiAdapter_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], WikiAdapter);
//# sourceMappingURL=wiki.adapter.js.map