// ──────────────────────────────────────────────────────────────
// Repos Controller – GET /api/repos, GET /api/repos/:id
// ──────────────────────────────────────────────────────────────

import { Controller, Get, Param, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FilterQueryDto } from '../common/dto';

@Controller('repos')
export class ReposController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listRepos(@Query() filters: FilterQueryDto) {
    const repos = await this.prisma.repository.findMany({
      include: {
        _count: {
          select: { branches: true, commits: true, pullRequests: true },
        },
      },
    });
    return { data: repos };
  }

  @Get(':id')
  async getRepoDetail(@Param('id') id: string, @Query() filters: FilterQueryDto) {
    const repo = await this.prisma.repository.findUnique({
      where: { id },
      include: {
        branches: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });

    if (!repo) return { error: 'Repository not found' };

    const periodStart = filters.dateFrom
      ? new Date(filters.dateFrom)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const periodEnd = filters.dateTo ? new Date(filters.dateTo) : new Date();

    const recentCommits = await this.prisma.commit.findMany({
      where: {
        repositoryId: id,
        timestamp: { gte: periodStart, lte: periodEnd },
      },
      orderBy: { timestamp: 'desc' },
      take: 50,
    });

    const openPRs = await this.prisma.pullRequest.findMany({
      where: {
        repositoryId: id,
        state: 'OPEN',
      },
      include: {
        author: true,
        reviews: { include: { reviewer: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const mergedPRs = await this.prisma.pullRequest.count({
      where: {
        repositoryId: id,
        state: 'MERGED',
        mergedAt: { gte: periodStart, lte: periodEnd },
      },
    });

    // Stale branches (no activity > 30 days)
    const staleCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const staleBranches = await this.prisma.branch.count({
      where: {
        repositoryId: id,
        createdAt: { lt: staleCutoff },
      },
    });

    return {
      data: {
        repo,
        recentCommits,
        openPRs,
        mergedPRCount: mergedPRs,
        staleBranchCount: staleBranches,
      },
    };
  }
}
