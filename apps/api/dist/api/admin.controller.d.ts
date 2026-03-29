import { PrismaService } from '../prisma/prisma.service';
export declare class AdminController {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getSettings(orgId: string): Promise<{
        data: {
            settings: {
                id: string;
                organizationId: string;
                readinessWeights: import("@prisma/client/runtime/library").JsonValue;
                issueKeyPattern: string;
                blockedStatuses: import("@prisma/client/runtime/library").JsonValue;
                throughputTypes: import("@prisma/client/runtime/library").JsonValue;
                escapedBugDays: number;
                includeLowConfLinks: boolean;
            } | null;
            statusMappings: {
                id: string;
                organizationId: string;
                canonicalState: string;
                projectKey: string;
                externalStatus: string;
            }[];
            thresholds: {
                id: string;
                settingsId: string;
                metricKey: string;
                warningThreshold: number;
                criticalThreshold: number;
                direction: string;
            }[];
            weights: {
                id: string;
                weight: number;
                settingsId: string;
                compositeMetricKey: string;
                inputMetricKey: string;
            }[];
        };
    }>;
    updateSettings(body: {
        orgId: string;
        data: Record<string, unknown>;
    }): Promise<{
        data: {
            id: string;
            organizationId: string;
            readinessWeights: import("@prisma/client/runtime/library").JsonValue;
            issueKeyPattern: string;
            blockedStatuses: import("@prisma/client/runtime/library").JsonValue;
            throughputTypes: import("@prisma/client/runtime/library").JsonValue;
            escapedBugDays: number;
            includeLowConfLinks: boolean;
        };
    }>;
    updateStatusMappings(body: {
        orgId: string;
        mappings: Array<{
            externalStatus: string;
            canonicalState: string;
            projectKey?: string;
        }>;
    }): Promise<{
        data: {
            id: string;
            organizationId: string;
            canonicalState: string;
            projectKey: string;
            externalStatus: string;
        }[];
    }>;
    updateThresholds(body: {
        orgId: string;
        thresholds: Array<{
            metricKey: string;
            warningThreshold: number;
            criticalThreshold: number;
            direction?: string;
        }>;
    }): Promise<{
        error: string;
        data?: undefined;
    } | {
        data: {
            id: string;
            settingsId: string;
            metricKey: string;
            warningThreshold: number;
            criticalThreshold: number;
            direction: string;
        }[];
        error?: undefined;
    }>;
    updateWeights(body: {
        orgId: string;
        compositeMetricKey: string;
        weights: Array<{
            inputMetricKey: string;
            weight: number;
        }>;
    }): Promise<{
        error: string;
        data?: undefined;
    } | {
        data: {
            id: string;
            weight: number;
            settingsId: string;
            compositeMetricKey: string;
            inputMetricKey: string;
        }[];
        error?: undefined;
    }>;
}
//# sourceMappingURL=admin.controller.d.ts.map