import { PrismaService } from '../prisma/prisma.service';
import { MetricsEngineService } from '../metrics/engine.service';
import { InsightsService } from '../metrics/insights.service';
export declare class StoriesController {
    private readonly prisma;
    private readonly metricsEngine;
    private readonly insights;
    constructor(prisma: PrismaService, metricsEngine: MetricsEngineService, insights: InsightsService);
    getStoryDetail(issueKey: string): Promise<{
        error: string;
        data?: undefined;
    } | {
        data: {
            issue: {
                team: {
                    id: string;
                    programId: string | null;
                    name: string;
                    createdAt: Date;
                    organizationId: string;
                    slug: string;
                } | null;
                sprint: {
                    id: string;
                    externalId: string | null;
                    name: string;
                    projectId: string;
                    startDate: Date | null;
                    endDate: Date | null;
                    state: string;
                } | null;
                assignee: {
                    id: string;
                    createdAt: Date;
                    organizationId: string;
                    displayName: string;
                    email: string | null;
                    externalIds: import("@prisma/client/runtime/library").JsonValue;
                } | null;
                reporter: {
                    id: string;
                    createdAt: Date;
                    organizationId: string;
                    displayName: string;
                    email: string | null;
                    externalIds: import("@prisma/client/runtime/library").JsonValue;
                } | null;
                events: {
                    id: string;
                    authorId: string | null;
                    timestamp: Date;
                    issueId: string;
                    field: string;
                    fromValue: string | null;
                    toValue: string | null;
                }[];
                comments: {
                    id: string;
                    createdAt: Date;
                    updatedAt: Date;
                    authorId: string | null;
                    issueId: string;
                    body: string;
                }[];
            } & {
                id: string;
                externalId: string;
                createdAt: Date;
                projectId: string;
                type: string;
                status: string;
                issueKey: string;
                teamId: string | null;
                sprintId: string | null;
                epicKey: string | null;
                parentKey: string | null;
                priority: string;
                summary: string;
                description: string | null;
                acceptanceCriteria: string | null;
                canonicalState: string;
                assigneeId: string | null;
                reporterId: string | null;
                storyPoints: number | null;
                labels: import("@prisma/client/runtime/library").JsonValue;
                customFields: import("@prisma/client/runtime/library").JsonValue;
                updatedAt: Date;
                resolvedAt: Date | null;
                rawPayload: import("@prisma/client/runtime/library").JsonValue | null;
            };
            metrics: import("@devpilot/shared").StoryMetrics | null;
            timeline: ({
                type: "transition";
                timestamp: Date;
                summary: string;
                actor: string | null;
            } | {
                type: "comment";
                timestamp: Date;
                summary: string;
                actor: string | null;
            } | {
                type: "link";
                timestamp: Date;
                summary: string;
                actor: null;
            })[];
            linkedArtifacts: {
                id: string;
                createdAt: Date;
                issueKey: string;
                issueId: string | null;
                artifactType: string;
                artifactId: string;
                method: string;
                confidence: string;
                confidenceScore: number;
                isManual: boolean;
                overriddenBy: string | null;
                overrideReason: string | null;
            }[];
            annotations: ({
                author: {
                    id: string;
                    createdAt: Date;
                    organizationId: string;
                    displayName: string;
                    email: string | null;
                    externalIds: import("@prisma/client/runtime/library").JsonValue;
                };
            } & {
                id: string;
                createdAt: Date;
                authorId: string;
                issueId: string | null;
                targetType: string;
                targetId: string;
                note: string;
            })[];
            insights: import("@devpilot/shared").NarrativeInsight[];
        };
        error?: undefined;
    }>;
}
//# sourceMappingURL=stories.controller.d.ts.map