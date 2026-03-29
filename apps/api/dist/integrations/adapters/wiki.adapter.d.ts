import { ConfigService } from '@nestjs/config';
import type { IWikiAdapter, SyncOptions, SyncResult } from './adapter.interface';
export declare class WikiAdapter implements IWikiAdapter {
    private readonly config;
    private readonly logger;
    private readonly baseUrl;
    private readonly authHeader;
    constructor(config: ConfigService);
    testConnection(): Promise<boolean>;
    syncPages(_options: SyncOptions): Promise<SyncResult>;
    syncEdits(_pageId: string): Promise<SyncResult>;
}
//# sourceMappingURL=wiki.adapter.d.ts.map