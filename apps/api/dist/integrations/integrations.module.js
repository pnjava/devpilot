"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntegrationsModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("../prisma/prisma.service");
const adapter_interface_1 = require("./adapters/adapter.interface");
const jira_mock_adapter_1 = require("./adapters/jira-mock.adapter");
const jira_adapter_1 = require("./adapters/jira.adapter");
const bitbucket_mock_adapter_1 = require("./adapters/bitbucket-mock.adapter");
const bitbucket_adapter_1 = require("./adapters/bitbucket.adapter");
const wiki_mock_adapter_1 = require("./adapters/wiki-mock.adapter");
const wiki_adapter_1 = require("./adapters/wiki.adapter");
const sync_service_1 = require("./sync/sync.service");
let IntegrationsModule = class IntegrationsModule {
};
exports.IntegrationsModule = IntegrationsModule;
exports.IntegrationsModule = IntegrationsModule = __decorate([
    (0, common_1.Module)({
        providers: [
            sync_service_1.SyncService,
            {
                provide: adapter_interface_1.JIRA_ADAPTER,
                useFactory: (config, prisma) => {
                    return config.get('USE_MOCK_ADAPTERS') === 'true'
                        ? new jira_mock_adapter_1.JiraMockAdapter(prisma)
                        : new jira_adapter_1.JiraAdapter(prisma);
                },
                inject: [config_1.ConfigService, prisma_service_1.PrismaService],
            },
            {
                provide: adapter_interface_1.BITBUCKET_ADAPTER,
                useFactory: (config, prisma) => {
                    return config.get('USE_MOCK_ADAPTERS') === 'true'
                        ? new bitbucket_mock_adapter_1.BitbucketMockAdapter()
                        : new bitbucket_adapter_1.BitbucketAdapter(config, prisma);
                },
                inject: [config_1.ConfigService, prisma_service_1.PrismaService],
            },
            {
                provide: adapter_interface_1.WIKI_ADAPTER,
                useFactory: (config) => {
                    return config.get('USE_MOCK_ADAPTERS') === 'true'
                        ? new wiki_mock_adapter_1.WikiMockAdapter()
                        : new wiki_adapter_1.WikiAdapter(config);
                },
                inject: [config_1.ConfigService],
            },
        ],
        exports: [adapter_interface_1.JIRA_ADAPTER, adapter_interface_1.BITBUCKET_ADAPTER, adapter_interface_1.WIKI_ADAPTER, sync_service_1.SyncService],
    })
], IntegrationsModule);
//# sourceMappingURL=integrations.module.js.map