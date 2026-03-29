import type { IBitbucketAdapter, SyncOptions, SyncResult } from './adapter.interface';
export declare class BitbucketMockAdapter implements IBitbucketAdapter {
    private readonly logger;
    testConnection(): Promise<boolean>;
    syncRepositories(_options: SyncOptions): Promise<SyncResult>;
    syncCommits(_repoSlug: string, _options: SyncOptions): Promise<SyncResult>;
    syncPullRequests(_repoSlug: string, _options: SyncOptions): Promise<SyncResult>;
    syncBranches(_repoSlug: string): Promise<SyncResult>;
}
//# sourceMappingURL=bitbucket-mock.adapter.d.ts.map