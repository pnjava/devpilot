"use strict";
// ──────────────────────────────────────────────────────────────
// Alerts Controller – GET /api/alerts
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
exports.AlertsController = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const dto_1 = require("../common/dto");
let AlertsController = class AlertsController {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async listAlerts(filters) {
        const where = {};
        if (filters.teamId)
            where.teamId = filters.teamId;
        const alerts = await this.prisma.alert.findMany({
            where,
            include: {
                team: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
        });
        return { data: alerts };
    }
    async acknowledgeAlert(id) {
        const alert = await this.prisma.alert.update({
            where: { id },
            data: { isActive: false, resolvedAt: new Date() },
        });
        return { data: alert };
    }
};
exports.AlertsController = AlertsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.FilterQueryDto]),
    __metadata("design:returntype", Promise)
], AlertsController.prototype, "listAlerts", null);
__decorate([
    (0, common_1.Patch)(':id/acknowledge'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AlertsController.prototype, "acknowledgeAlert", null);
exports.AlertsController = AlertsController = __decorate([
    (0, common_1.Controller)('alerts'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AlertsController);
//# sourceMappingURL=alerts.controller.js.map