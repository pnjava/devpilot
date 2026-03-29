"use strict";
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
exports.BridgeController = void 0;
const common_1 = require("@nestjs/common");
const bridge_service_1 = require("./bridge.service");
let BridgeController = class BridgeController {
    bridge;
    constructor(bridge) {
        this.bridge = bridge;
    }
    async linkStoryToSession(issueKey, body) {
        // Resolve issueKey → issueId
        return this.bridge.linkStoryToSession(issueKey, // caller must resolve to ID or we extend the service
        body.sessionId, body.linkType);
    }
    async getGroomSessions(issueKey) {
        return this.bridge.getGroomSessionsForStory(issueKey);
    }
    async getReviewMetrics(repoSlug, days) {
        return this.bridge.getReviewMetrics(repoSlug, days ? parseInt(days) : 30);
    }
    async getKnowledge(issueKey) {
        return this.bridge.getKnowledgeForIssue(issueKey);
    }
    async getBehavioralPatterns(repoSlug) {
        return this.bridge.getActivePatternsForRepo(repoSlug);
    }
    async getCodeIntelligence(repoSlug) {
        return this.bridge.getCodeIntelligenceSummary(repoSlug);
    }
};
exports.BridgeController = BridgeController;
__decorate([
    (0, common_1.Post)('stories/:issueKey/groom-links'),
    __param(0, (0, common_1.Param)('issueKey')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], BridgeController.prototype, "linkStoryToSession", null);
__decorate([
    (0, common_1.Get)('stories/:issueKey/groom-sessions'),
    __param(0, (0, common_1.Param)('issueKey')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], BridgeController.prototype, "getGroomSessions", null);
__decorate([
    (0, common_1.Get)('repos/:repoSlug/review-metrics'),
    __param(0, (0, common_1.Param)('repoSlug')),
    __param(1, (0, common_1.Query)('days')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], BridgeController.prototype, "getReviewMetrics", null);
__decorate([
    (0, common_1.Get)('stories/:issueKey/knowledge'),
    __param(0, (0, common_1.Param)('issueKey')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], BridgeController.prototype, "getKnowledge", null);
__decorate([
    (0, common_1.Get)('repos/:repoSlug/behavioral-patterns'),
    __param(0, (0, common_1.Param)('repoSlug')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], BridgeController.prototype, "getBehavioralPatterns", null);
__decorate([
    (0, common_1.Get)('repos/:repoSlug/code-intelligence'),
    __param(0, (0, common_1.Param)('repoSlug')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], BridgeController.prototype, "getCodeIntelligence", null);
exports.BridgeController = BridgeController = __decorate([
    (0, common_1.Controller)('bridge'),
    __metadata("design:paramtypes", [bridge_service_1.BridgeService])
], BridgeController);
//# sourceMappingURL=bridge.controller.js.map