import { PrismaService } from '../prisma/prisma.service';
import { MetricsEngineService } from '../metrics/engine.service';
import { InsightsService } from '../metrics/insights.service';
import { FilterQueryDto } from '../common/dto';
export declare class OverviewController {
    private readonly prisma;
    private readonly metricsEngine;
    private readonly insights;
    constructor(prisma: PrismaService, metricsEngine: MetricsEngineService, insights: InsightsService);
    getOverview(filters: FilterQueryDto): Promise<{
        data: {
            deliveryHealthIndex: number;
            deliveryHealthFactors: Record<string, number>;
            teamRiskScores: {
                teamId: string;
                teamName: string;
                riskScore: number;
            }[];
            topRiskStories: {
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
            teamsNeedingAttention: {
                teamId: string;
                teamName: string;
                reasons: string[];
            }[];
            recentAlerts: {
                id: string;
                createdAt: Date;
                type: string;
                organizationId: string;
                isActive: boolean;
                issueKey: string | null;
                teamId: string | null;
                description: string;
                resolvedAt: Date | null;
                title: string;
                severity: string;
                metric: string | null;
                metricValue: number | null;
                threshold: number | null;
            }[];
            insights: unknown[];
        };
    }>;
}
//# sourceMappingURL=overview.controller.d.ts.map