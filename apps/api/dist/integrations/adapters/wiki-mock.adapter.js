"use strict";
// ──────────────────────────────────────────────────────────────
// Mock Wiki / Confluence Adapter
// ──────────────────────────────────────────────────────────────
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var WikiMockAdapter_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WikiMockAdapter = void 0;
const common_1 = require("@nestjs/common");
let WikiMockAdapter = WikiMockAdapter_1 = class WikiMockAdapter {
    logger = new common_1.Logger(WikiMockAdapter_1.name);
    async testConnection() {
        this.logger.log('Mock Wiki: connection OK');
        return true;
    }
    async syncPages(_options) {
        this.logger.log('Mock Wiki: pages created via seed');
        return { itemsSynced: 0, errors: [], hasMore: false };
    }
    async syncEdits(_pageId) {
        this.logger.log('Mock Wiki: edits created via seed');
        return { itemsSynced: 0, errors: [], hasMore: false };
    }
};
exports.WikiMockAdapter = WikiMockAdapter;
exports.WikiMockAdapter = WikiMockAdapter = WikiMockAdapter_1 = __decorate([
    (0, common_1.Injectable)()
], WikiMockAdapter);
//# sourceMappingURL=wiki-mock.adapter.js.map