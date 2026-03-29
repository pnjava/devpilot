import { PrismaService } from '../prisma/prisma.service';
import { FilterQueryDto } from '../common/dto';
export declare class AlertsController {
    private readonly prisma;
    constructor(prisma: PrismaService);
    listAlerts(filters: FilterQueryDto): Promise<{
        data: ({
            team: {
                id: string;
                programId: string | null;
                name: string;
                createdAt: Date;
                organizationId: string;
                slug: string;
            } | null;
        } & {
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
        })[];
    }>;
    acknowledgeAlert(id: string): Promise<{
        data: {
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
        };
    }>;
}
//# sourceMappingURL=alerts.controller.d.ts.map