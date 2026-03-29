import { BridgeService } from './bridge.service';
export declare class BridgeController {
    private readonly bridge;
    constructor(bridge: BridgeService);
    linkStoryToSession(issueKey: string, body: {
        sessionId: string;
        linkType?: string;
    }): Promise<{
        id: string;
        createdAt: Date;
        issueId: string;
        sessionId: string;
        linkType: string;
    }>;
    getGroomSessions(issueKey: string): Promise<({
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
    getReviewMetrics(repoSlug: string, days?: string): Promise<{
        reviewCount: number;
        avgRiskScore: number;
        totalBlockers: number;
        totalWarnings: number;
        avgDurationMs: number;
        verdictBreakdown: Record<string, number>;
    } | null>;
    getKnowledge(issueKey: string): Promise<({
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
    getBehavioralPatterns(repoSlug: string): Promise<{
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
    getCodeIntelligence(repoSlug: string): Promise<{
        fileCount: number;
        symbolCount: number;
        graphNodeCount: number;
        lastIndexedAt: Date | null;
        lastDurationMs: number | null;
    }>;
}
//# sourceMappingURL=bridge.controller.d.ts.map