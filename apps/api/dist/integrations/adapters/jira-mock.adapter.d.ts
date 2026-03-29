import { PrismaService } from '../../prisma/prisma.service';
import type { IJiraAdapter, SyncOptions, SyncResult } from './adapter.interface';
export declare class JiraMockAdapter implements IJiraAdapter {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    testConnection(): Promise<boolean>;
    syncProjects(): Promise<SyncResult>;
    syncSprints(projectKey: string): Promise<SyncResult>;
    syncIssues(_options: SyncOptions): Promise<SyncResult>;
}
//# sourceMappingURL=jira-mock.adapter.d.ts.map