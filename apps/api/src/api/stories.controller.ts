// ──────────────────────────────────────────────────────────────
// Stories Controller – GET /api/stories/:issueKey
// ──────────────────────────────────────────────────────────────

import { Controller, Get, Param } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsEngineService } from '../metrics/engine.service';
import { InsightsService } from '../metrics/insights.service';

@Controller('stories')
export class StoriesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metricsEngine: MetricsEngineService,
    private readonly insights: InsightsService,
  ) {}

  @Get(':issueKey')
  async getStoryDetail(@Param('issueKey') issueKey: string) {
    const issue = await this.prisma.issue.findFirst({
      where: { issueKey },
      include: {
        events: { orderBy: { timestamp: 'asc' } },
        comments: { orderBy: { createdAt: 'asc' } },
        assignee: true,
        reporter: true,
        sprint: true,
        team: true,
      },
    });

    if (!issue) return { error: 'Story not found' };

    const metrics = await this.metricsEngine.computeStoryMetrics(issueKey);
    const narrativeInsights = metrics ? this.insights.generateStoryInsight(metrics) : [];

    // Linked artifacts
    const links = await this.prisma.artifactLink.findMany({
      where: { issueId: issue.id },
      orderBy: { createdAt: 'desc' },
    });

    // Build timeline from events + comments + links
    const timeline = [
      ...issue.events.map((e) => ({
        type: 'transition' as const,
        timestamp: e.timestamp,
        summary: `${e.field}: ${e.fromValue ?? '(none)'} → ${e.toValue ?? '(none)'}`,
        actor: e.authorId,
      })),
      ...issue.comments.map((c) => ({
        type: 'comment' as const,
        timestamp: c.createdAt,
        summary: c.body.slice(0, 200),
        actor: c.authorId,
      })),
      ...links.map((l) => ({
        type: 'link' as const,
        timestamp: l.createdAt,
        summary: `${l.artifactType} linked via ${l.method} (confidence: ${l.confidence})`,
        actor: null,
      })),
    ].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    // Manual annotations
    const annotations = await this.prisma.manualAnnotation.findMany({
      where: { issueId: issue.id },
      include: { author: true },
      orderBy: { createdAt: 'desc' },
    });

    return {
      data: {
        issue,
        metrics,
        timeline,
        linkedArtifacts: links,
        annotations,
        insights: narrativeInsights,
      },
    };
  }
}
