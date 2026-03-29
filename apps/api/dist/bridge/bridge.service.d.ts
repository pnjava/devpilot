import { PrismaService } from '../prisma/prisma.service';
/**
 * Bridge Service – Connects PIDI delivery metrics with GroomPilot grooming
 * and review data. Enables:
 *   - Story readiness fed by live review metrics
 *   - Grooming sessions linked to PIDI issues via StoryGroomLink
 *   - PR review findings surfaced in delivery dashboards
 *   - Knowledge warehouse docs linked to traceability chains
 */
export declare class BridgeService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    /** Link a PIDI issue to a grooming session */
    linkStoryToSession(issueId: string, sessionId: string, linkType?: string): Promise<{
        id: string;
        createdAt: Date;
        issueId: string;
        sessionId: string;
        linkType: string;
    }>;
    /** Get all grooming sessions for a PIDI issue */
    getGroomSessionsForStory(issueKey: string): Promise<({
        session: {
            id: string;
            createdAt: Date;
            data: import("@prisma/client/runtime/library").JsonValue;
            updatedAt: Date;
            title: string;
            createdById: string;
            storyId: string | null;
            repoOwner: string | null;
            repoName: string | null;
        };
    } & {
        id: string;
        createdAt: Date;
        issueId: string;
        sessionId: string;
        linkType: string;
    })[]>;
    /** Aggregate review run stats for a repo (last N days) */
    getReviewMetrics(repoSlug: string, days?: number): Promise<{
        reviewCount: number;
        avgRiskScore: number;
        totalBlockers: number;
        totalWarnings: number;
        avgDurationMs: number;
        verdictBreakdown: Record<string, number>;
    } | null>;
    /** Get knowledge docs linked to a Jira issue */
    getKnowledgeForIssue(issueKey: string): Promise<({
        document: {
            facts: {
                id: number;
                createdAt: Date;
                weight: number;
                documentId: string;
                category: string;
                heading: string | null;
                content: string;
            }[];
            tags: {
                id: number;
                createdAt: Date;
                documentId: string;
                tagType: string;
                tagValue: string;
            }[];
        } & {
            id: string;
            createdAt: Date;
            metadata: import("@prisma/client/runtime/library").JsonValue;
            updatedAt: Date;
            title: string;
            url: string | null;
            sourceType: string;
            sourceSpace: string | null;
            sourcePageId: string | null;
            bodyExcerpt: string | null;
        };
    } & {
        id: number;
        createdAt: Date;
        confidence: number;
        jiraKey: string;
        documentId: string;
        source: string;
    })[]>;
    /** Get active behavioral patterns for a repo */
    getActivePatternsForRepo(repoSlug: string): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        confidence: number;
        repoSlug: string;
        source: string;
        patternName: string;
        guidance: string;
        appliesTo: import("@prisma/client/runtime/library").JsonValue;
        severitySignal: string;
        batchRunId: string | null;
        enabled: boolean;
    }[]>;
    /** Get code intelligence summary for a repo */
    getCodeIntelligenceSummary(repoSlug: string): Promise<{
        fileCount: number;
        symbolCount: number;
        graphNodeCount: number;
        lastIndexedAt: Date | null;
        lastDurationMs: number | null;
    }>;
}
//# sourceMappingURL=bridge.service.d.ts.map