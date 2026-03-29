import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import type { IBitbucketAdapter, SyncOptions, SyncResult } from './adapter.interface';
export declare class BitbucketAdapter implements IBitbucketAdapter {
    private readonly config;
    private readonly prisma;
    private readonly logger;
    private readonly baseUrl;
    private readonly workspace;
    private readonly authHeader;
    constructor(config: ConfigService, prisma: PrismaService);
    private bbFetch;
    testConnection(): Promise<boolean>;
    syncRepositories(_options: SyncOptions): Promise<SyncResult>;
    syncCommits(_repoSlug: string, _options: SyncOptions): Promise<SyncResult>;
    syncPullRequests(_repoSlug: string, _options: SyncOptions): Promise<SyncResult>;
    syncBranches(_repoSlug: string): Promise<SyncResult>;
}
//# sourceMappingURL=bitbucket.adapter.d.ts.map