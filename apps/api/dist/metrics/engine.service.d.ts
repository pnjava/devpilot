import { PrismaService } from '../prisma/prisma.service';
import type { StoryMetrics, TeamMetrics } from '@devpilot/shared';
export declare class MetricsEngineService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    computeStoryMetrics(issueKey: string): Promise<StoryMetrics | null>;
    computeTeamMetrics(teamId: string, periodStart: Date, periodEnd: Date): Promise<TeamMetrics | null>;
    private getStatusMap;
}
//# sourceMappingURL=engine.service.d.ts.map