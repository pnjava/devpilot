import type { IWikiAdapter, SyncOptions, SyncResult } from './adapter.interface';
export declare class WikiMockAdapter implements IWikiAdapter {
    private readonly logger;
    testConnection(): Promise<boolean>;
    syncPages(_options: SyncOptions): Promise<SyncResult>;
    syncEdits(_pageId: string): Promise<SyncResult>;
}
//# sourceMappingURL=wiki-mock.adapter.d.ts.map