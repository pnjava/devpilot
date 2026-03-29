"use strict";
// ──────────────────────────────────────────────────────────────
// Admin Controller – GET/PUT /api/admin/settings, status-mappings,
//   thresholds, weights
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
exports.AdminController = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const roles_decorator_1 = require("../auth/roles.decorator");
let AdminController = class AdminController {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getSettings(orgId) {
        const settings = await this.prisma.organizationSettings.findFirst({
            where: orgId ? { organizationId: orgId } : undefined,
        });
        const statusMappings = await this.prisma.statusMapping.findMany({
            where: orgId ? { organizationId: orgId } : undefined,
        });
        const thresholds = settings
            ? await this.prisma.metricThresholdConfig.findMany({
                where: { settingsId: settings.id },
            })
            : [];
        const weights = settings
            ? await this.prisma.metricWeightConfig.findMany({
                where: { settingsId: settings.id },
            })
            : [];
        return {
            data: {
                settings,
                statusMappings,
                thresholds,
                weights,
            },
        };
    }
    async updateSettings(body) {
        const updated = await this.prisma.organizationSettings.upsert({
            where: { organizationId: body.orgId },
            update: body.data,
            create: { organizationId: body.orgId, ...body.data },
        });
        return { data: updated };
    }
    async updateStatusMappings(body) {
        const results = await Promise.all(body.mappings.map((m) => {
            const projectKey = m.projectKey ?? '__default__';
            return this.prisma.statusMapping.upsert({
                where: {
                    organizationId_projectKey_externalStatus: {
                        organizationId: body.orgId,
                        projectKey,
                        externalStatus: m.externalStatus,
                    },
                },
                update: { canonicalState: m.canonicalState },
                create: {
                    organizationId: body.orgId,
                    projectKey,
                    externalStatus: m.externalStatus,
                    canonicalState: m.canonicalState,
                },
            });
        }));
        return { data: results };
    }
    async updateThresholds(body) {
        const settings = await this.prisma.organizationSettings.findUnique({
            where: { organizationId: body.orgId },
        });
        if (!settings)
            return { error: 'Settings not found for this org' };
        const results = await Promise.all(body.thresholds.map((t) => this.prisma.metricThresholdConfig.upsert({
            where: {
                settingsId_metricKey: {
                    settingsId: settings.id,
                    metricKey: t.metricKey,
                },
            },
            update: {
                warningThreshold: t.warningThreshold,
                criticalThreshold: t.criticalThreshold,
                direction: t.direction ?? 'ABOVE',
            },
            create: {
                settingsId: settings.id,
                metricKey: t.metricKey,
                warningThreshold: t.warningThreshold,
                criticalThreshold: t.criticalThreshold,
                direction: t.direction ?? 'ABOVE',
            },
        })));
        return { data: results };
    }
    async updateWeights(body) {
        const settings = await this.prisma.organizationSettings.findUnique({
            where: { organizationId: body.orgId },
        });
        if (!settings)
            return { error: 'Settings not found for this org' };
        const results = await Promise.all(body.weights.map((w) => this.prisma.metricWeightConfig.upsert({
            where: {
                settingsId_compositeMetricKey_inputMetricKey: {
                    settingsId: settings.id,
                    compositeMetricKey: body.compositeMetricKey,
                    inputMetricKey: w.inputMetricKey,
                },
            },
            update: { weight: w.weight },
            create: {
                settingsId: settings.id,
                compositeMetricKey: body.compositeMetricKey,
                inputMetricKey: w.inputMetricKey,
                weight: w.weight,
            },
        })));
        return { data: results };
    }
};
exports.AdminController = AdminController;
__decorate([
    (0, common_1.Get)('settings'),
    (0, roles_decorator_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Query)('orgId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getSettings", null);
__decorate([
    (0, common_1.Put)('settings'),
    (0, roles_decorator_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "updateSettings", null);
__decorate([
    (0, common_1.Put)('status-mappings'),
    (0, roles_decorator_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "updateStatusMappings", null);
__decorate([
    (0, common_1.Put)('thresholds'),
    (0, roles_decorator_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "updateThresholds", null);
__decorate([
    (0, common_1.Put)('weights'),
    (0, roles_decorator_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "updateWeights", null);
exports.AdminController = AdminController = __decorate([
    (0, common_1.Controller)('admin'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AdminController);
//# sourceMappingURL=admin.controller.js.map