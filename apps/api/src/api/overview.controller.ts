// ──────────────────────────────────────────────────────────────
// Overview Controller – GET /api/overview
// ──────────────────────────────────────────────────────────────

import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsEngineService } from '../metrics/engine.service';
import { InsightsService } from '../metrics/insights.service';
import { FilterQueryDto } from '../common/dto';

@Controller('overview')
export class OverviewController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metricsEngine: MetricsEngineService,
    private readonly insights: InsightsService,
  ) {}

  @Get()
  async getOverview(@Query() filters: FilterQueryDto) {
    const teams = await this.prisma.team.findMany({
      where: filters.teamId ? { id: filters.teamId } : undefined,
    });

    const periodStart = filters.dateFrom ? new Date(filters.dateFrom) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const periodEnd = filters.dateTo ? new Date(filters.dateTo) : new Date();

    const teamRiskScores: Array<{ teamId: string; teamName: string; riskScore: number }> = [];
    const allInsights: Array<unknown> = [];

    let overallHealthIndex = 0;
    const overallHealthFactors: Record<string, number> = {};

    for (const team of teams) {
      const metrics = await this.metricsEngine.computeTeamMetrics(team.id, periodStart, periodEnd);
      if (metrics) {
        teamRiskScores.push({
          teamId: team.id,
          teamName: team.name,
          riskScore: metrics.teamRiskScore,
        });
        overallHealthIndex += metrics.deliveryHealthIndex;

        const teamInsights = this.insights.generateTeamInsights(metrics);
        allInsights.push(...teamInsights);
      }
    }

    if (teams.length > 0) {
      overallHealthIndex = Math.round(overallHealthIndex / teams.length);
    }

    // Top risk stories
    const topRiskStories = await this.prisma.issue.findMany({
      where: {
        canonicalState: { in: ['IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'] },
        ...(filters.teamId ? { teamId: filters.teamId } : {}),
      },
      orderBy: { updatedAt: 'asc' },
      take: 10,
    });

    // Recent alerts
    const recentAlerts = await this.prisma.alert.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return {
      data: {
        deliveryHealthIndex: overallHealthIndex,
        deliveryHealthFactors: overallHealthFactors,
        teamRiskScores,
        topRiskStories,
        teamsNeedingAttention: teamRiskScores
          .filter((t) => t.riskScore > 50)
          .map((t) => ({
            teamId: t.teamId,
            teamName: t.teamName,
            reasons: ['High risk score'],
          })),
        recentAlerts,
        insights: allInsights,
      },
    };
  }
}
