import { PrismaService } from '../../prisma/prisma.service';
import type { IJiraAdapter, SyncOptions, SyncResult } from './adapter.interface';
export declare class JiraAdapter implements IJiraAdapter {
    private readonly prisma;
    private readonly logger;
    private readonly client;
    constructor(prisma: PrismaService);
    testConnection(): Promise<boolean>;
    syncProjects(): Promise<SyncResult>;
    syncSprints(projectKey: string): Promise<SyncResult>;
    syncIssues(options: SyncOptions): Promise<SyncResult>;
}
//# sourceMappingURL=jira.adapter.d.ts.map