import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Bridge Service – Connects PIDI delivery metrics with GroomPilot grooming
 * and review data. Enables:
 *   - Story readiness fed by live review metrics
 *   - Grooming sessions linked to PIDI issues via StoryGroomLink
 *   - PR review findings surfaced in delivery dashboards
 *   - Knowledge warehouse docs linked to traceability chains
 */
@Injectable()
export class BridgeService {
  private readonly logger = new Logger(BridgeService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Story → Grooming Links ────────────────────────────────

  /** Link a PIDI issue to a grooming session */
  async linkStoryToSession(
    issueId: string,
    sessionId: string,
    linkType: string = 'groomed',
  ) {
    return this.prisma.storyGroomLink.upsert({
      where: { issueId_sessionId: { issueId, sessionId } },
      create: { issueId, sessionId, linkType },
      update: { linkType },
    });
  }

  /** Get all grooming sessions for a PIDI issue */
  async getGroomSessionsForStory(issueKey: string) {
    const issue = await this.prisma.issue.findUnique({
      where: { issueKey },
      include: {
        storyGroomLinks: {
          include: { session: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    return issue?.storyGroomLinks ?? [];
  }

  // ── Review Metrics for Delivery Dashboard ─────────────────

  /** Aggregate review run stats for a repo (last N days) */
  async getReviewMetrics(repoSlug: string, days: number = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const runs = await this.prisma.reviewRun.findMany({
      where: { repoSlug, completedAt: { gte: since } },
      select: {
        riskScore: true,
        totalFindings: true,
        blockers: true,
        warnings: true,
        durationMs: true,
        changeType: true,
        verdict: true,
      },
    });

    if (runs.length === 0) return null;

    const avgRiskScore =
      runs.reduce((sum, r) => sum + r.riskScore, 0) / runs.length;
    const totalBlockers = runs.reduce((sum, r) => sum + r.blockers, 0);
    const totalWarnings = runs.reduce((sum, r) => sum + r.warnings, 0);
    const avgDuration =
      runs.reduce((sum, r) => sum + r.durationMs, 0) / runs.length;

    return {
      reviewCount: runs.length,
      avgRiskScore: Math.round(avgRiskScore * 10) / 10,
      totalBlockers,
      totalWarnings,
      avgDurationMs: Math.round(avgDuration),
      verdictBreakdown: runs.reduce(
        (acc, r) => {
          acc[r.verdict] = (acc[r.verdict] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
    };
  }

  // ── Knowledge → Traceability ──────────────────────────────

  /** Get knowledge docs linked to a Jira issue */
  async getKnowledgeForIssue(issueKey: string) {
    const links = await this.prisma.knowledgeJiraLink.findMany({
      where: { jiraKey: issueKey },
      include: {
        document: {
          include: { facts: true, tags: true },
        },
      },
      orderBy: { confidence: 'desc' },
    });
    return links;
  }

  // ── BPE Insights for Team Dashboard ───────────────────────

  /** Get active behavioral patterns for a repo */
  async getActivePatternsForRepo(repoSlug: string) {
    return this.prisma.bpePattern.findMany({
      where: { repoSlug, enabled: true },
      orderBy: { confidence: 'desc' },
    });
  }

  // ── RCIE Code Intelligence for Review ─────────────────────

  /** Get code intelligence summary for a repo */
  async getCodeIntelligenceSummary(repoSlug: string) {
    const [fileCount, symbolCount, graphNodeCount, lastRun] = await Promise.all(
      [
        this.prisma.repoCodeFile.count({ where: { repoSlug } }),
        this.prisma.repoCodeSymbol.count({ where: { repoSlug } }),
        this.prisma.repoCodeGraphNode.count({ where: { repoSlug } }),
        this.prisma.repoIndexRun.findFirst({
          where: { repoSlug, status: 'completed' },
          orderBy: { completedAt: 'desc' },
        }),
      ],
    );

    return {
      fileCount,
      symbolCount,
      graphNodeCount,
      lastIndexedAt: lastRun?.completedAt ?? null,
      lastDurationMs: lastRun?.durationMs ?? null,
    };
  }
}
