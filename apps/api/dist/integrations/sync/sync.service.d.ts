import { PrismaService } from '../../prisma/prisma.service';
import { type IJiraAdapter, type IBitbucketAdapter, type IWikiAdapter } from '../adapters/adapter.interface';
export declare class SyncService {
    private readonly prisma;
    private readonly jira;
    private readonly bitbucket;
    private readonly wiki;
    private readonly logger;
    constructor(prisma: PrismaService, jira: IJiraAdapter, bitbucket: IBitbucketAdapter, wiki: IWikiAdapter);
    runJiraSync(connectionId: string, full?: boolean): Promise<void>;
    runBitbucketSync(connectionId: string, full?: boolean): Promise<void>;
    runWikiSync(connectionId: string, full?: boolean): Promise<void>;
}
//# sourceMappingURL=sync.service.d.ts.map