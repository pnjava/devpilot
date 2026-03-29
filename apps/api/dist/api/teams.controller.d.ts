import { PrismaService } from '../prisma/prisma.service';
import { MetricsEngineService } from '../metrics/engine.service';
import { InsightsService } from '../metrics/insights.service';
import { FilterQueryDto } from '../common/dto';
export declare class TeamsController {
    private readonly prisma;
    private readonly metricsEngine;
    private readonly insights;
    constructor(prisma: PrismaService, metricsEngine: MetricsEngineService, insights: InsightsService);
    listTeams(filters: FilterQueryDto): Promise<{
        data: ({
            _count: {
                issues: number;
                memberships: number;
            };
        } & {
            id: string;
            programId: string | null;
            name: string;
            createdAt: Date;
            organizationId: string;
            slug: string;
        })[];
    }>;
    getTeamDetail(id: string, filters: FilterQueryDto): Promise<{
        error: string;
        data?: undefined;
    } | {
        data: {
            team: {
                memberships: ({
                    person: {
                        id: string;
                        createdAt: Date;
                        organizationId: string;
                        displayName: string;
                        email: string | null;
                        externalIds: import("@prisma/client/runtime/library").JsonValue;
                    };
                } & {
                    id: string;
                    startDate: Date;
                    endDate: Date | null;
                    teamId: string;
                    personId: string;
                    role: string;
                })[];
            } & {
                id: string;
                programId: string | null;
                name: string;
                createdAt: Date;
                organizationId: string;
                slug: string;
            };
            metrics: import("@devpilot/shared").TeamMetrics | null;
            agingStories: {
                ageDays: number;
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
            }[];
            insights: import("@devpilot/shared").NarrativeInsight[];
        };
        error?: undefined;
    }>;
}
//# sourceMappingURL=teams.controller.d.ts.map