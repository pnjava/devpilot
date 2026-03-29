"use strict";
// ──────────────────────────────────────────────────────────────
// Api Module – registers all REST controllers
// ──────────────────────────────────────────────────────────────
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiModule = void 0;
const common_1 = require("@nestjs/common");
const metrics_module_1 = require("../metrics/metrics.module");
const traceability_module_1 = require("../traceability/traceability.module");
const integrations_module_1 = require("../integrations/integrations.module");
const overview_controller_1 = require("./overview.controller");
const teams_controller_1 = require("./teams.controller");
const stories_controller_1 = require("./stories.controller");
const people_controller_1 = require("./people.controller");
const repos_controller_1 = require("./repos.controller");
const alerts_controller_1 = require("./alerts.controller");
const integrations_controller_1 = require("./integrations.controller");
const links_controller_1 = require("./links.controller");
const admin_controller_1 = require("./admin.controller");
let ApiModule = class ApiModule {
};
exports.ApiModule = ApiModule;
exports.ApiModule = ApiModule = __decorate([
    (0, common_1.Module)({
        imports: [metrics_module_1.MetricsModule, traceability_module_1.TraceabilityModule, integrations_module_1.IntegrationsModule],
        controllers: [
            overview_controller_1.OverviewController,
            teams_controller_1.TeamsController,
            stories_controller_1.StoriesController,
            people_controller_1.PeopleController,
            repos_controller_1.ReposController,
            alerts_controller_1.AlertsController,
            integrations_controller_1.IntegrationsController,
            links_controller_1.LinksController,
            admin_controller_1.AdminController,
        ],
    })
], ApiModule);
//# sourceMappingURL=api.module.js.map