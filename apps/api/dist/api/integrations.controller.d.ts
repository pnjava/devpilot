import { PrismaService } from '../prisma/prisma.service';
import { SyncService } from '../integrations/sync/sync.service';
import { FilterQueryDto } from '../common/dto';
export declare class IntegrationsController {
    private readonly prisma;
    private readonly syncService;
    constructor(prisma: PrismaService, syncService: SyncService);
    getIntegrationStatus(filters: FilterQueryDto): Promise<{
        data: {
            connections: {
                id: string;
                createdAt: Date;
                type: string;
                organizationId: string;
                baseUrl: string;
                isActive: boolean;
                lastSyncAt: Date | null;
                lastSyncStatus: string | null;
                config: import("@prisma/client/runtime/library").JsonValue;
            }[];
            recentJobs: {
                id: string;
                itemsSynced: number;
                errors: import("@prisma/client/runtime/library").JsonValue;
                type: string;
                status: string;
                startedAt: Date;
                completedAt: Date | null;
                cursor: string | null;
                metadata: import("@prisma/client/runtime/library").JsonValue | null;
                connectionId: string;
            }[];
        };
    }>;
    triggerSync(body: {
        orgId: string;
        types?: string[];
    }): Promise<{
        data: Record<string, unknown>;
    }>;
}
//# sourceMappingURL=integrations.controller.d.ts.map