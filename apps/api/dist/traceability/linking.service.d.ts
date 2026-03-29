import { PrismaService } from '../prisma/prisma.service';
export declare class LinkingService {
    private readonly prisma;
    private readonly logger;
    private issueKeyPattern;
    constructor(prisma: PrismaService);
    recomputeAllLinks(organizationId: string): Promise<void>;
    private linkBranches;
    private linkCommits;
    private linkPullRequests;
    private linkWikiPages;
    createManualLink(issueKey: string, artifactType: string, artifactId: string, authorId: string, reason?: string): Promise<void>;
    removeLink(linkId: string): Promise<void>;
    private extractIssueKeys;
    private upsertLinks;
}
//# sourceMappingURL=linking.service.d.ts.map