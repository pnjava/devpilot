"use strict";
// ──────────────────────────────────────────────────────────────
// Links Controller – POST /api/links/manual, DELETE /api/links/:id
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
exports.LinksController = void 0;
const common_1 = require("@nestjs/common");
const linking_service_1 = require("../traceability/linking.service");
const dto_1 = require("../common/dto");
const roles_decorator_1 = require("../auth/roles.decorator");
let LinksController = class LinksController {
    linkingService;
    constructor(linkingService) {
        this.linkingService = linkingService;
    }
    async createManualLink(body) {
        const link = await this.linkingService.createManualLink(body.issueKey, body.artifactType, body.artifactId, '', // authorId not in DTO; could be extracted from auth context
        body.reason);
        return { data: link };
    }
    async removeLink(id) {
        await this.linkingService.removeLink(id);
        return { data: { deleted: true } };
    }
};
exports.LinksController = LinksController;
__decorate([
    (0, common_1.Post)('manual'),
    (0, roles_decorator_1.Roles)('ADMIN', 'DELIVERY_PARTNER', 'ENGINEERING_MANAGER', 'TEAM_LEAD'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CreateManualLinkDto]),
    __metadata("design:returntype", Promise)
], LinksController.prototype, "createManualLink", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, roles_decorator_1.Roles)('ADMIN', 'DELIVERY_PARTNER'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], LinksController.prototype, "removeLink", null);
exports.LinksController = LinksController = __decorate([
    (0, common_1.Controller)('links'),
    __metadata("design:paramtypes", [linking_service_1.LinkingService])
], LinksController);
//# sourceMappingURL=links.controller.js.map