// ──────────────────────────────────────────────────────────────
// Teams Controller – GET /api/teams, GET /api/teams/:id
// ──────────────────────────────────────────────────────────────

import { Controller, Get, Param, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsEngineService } from '../metrics/engine.service';
import { InsightsService } from '../metrics/insights.service';
import { FilterQueryDto } from '../common/dto';

@Controller('teams')
export class TeamsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metricsEngine: MetricsEngineService,
    private readonly insights: InsightsService,
  ) {}

  @Get()
  async listTeams(@Query() filters: FilterQueryDto) {
    const teams = await this.prisma.team.findMany({
      include: { _count: { select: { memberships: true, issues: true } } },
    });
    return { data: teams };
  }

  @Get(':id')
  async getTeamDetail(@Param('id') id: string, @Query() filters: FilterQueryDto) {
    const team = await this.prisma.team.findUnique({
      where: { id },
      include: {
        memberships: { include: { person: true } },
      },
    });

    if (!team) return { error: 'Team not found' };

    const periodStart = filters.dateFrom
      ? new Date(filters.dateFrom)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const periodEnd = filters.dateTo ? new Date(filters.dateTo) : new Date();

    const metrics = await this.metricsEngine.computeTeamMetrics(id, periodStart, periodEnd);
    const narrativeInsights = metrics ? this.insights.generateTeamInsights(metrics) : [];

    // Aging stories
    const agingStories = await this.prisma.issue.findMany({
      where: {
        teamId: id,
        canonicalState: { in: ['IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'] },
      },
      orderBy: { updatedAt: 'asc' },
      take: 20,
    });

    return {
      data: {
        team,
        metrics,
        agingStories: agingStories.map((s) => ({
          ...s,
          ageDays: Math.round(
            (Date.now() - s.updatedAt.getTime()) / (1000 * 60 * 60 * 24),
          ),
        })),
        insights: narrativeInsights,
      },
    };
  }
}
