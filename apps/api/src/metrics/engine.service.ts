// ──────────────────────────────────────────────────────────────
// Metrics Engine Service
// Orchestrates metric computation across stories, teams, people.
// ──────────────────────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CanonicalState } from '@devpilot/shared';
import {
  computeReadinessFactors,
  computeReadinessScore,
  computeChurnCount,
  computeChurnScore,
  computeClarificationIntensity,
  extractStatusTransitions,
  findFirstTransitionTo,
  findLastTransitionTo,
  computeLeadTime,
  computeCycleTime,
  computeBlockedTime,
  computeBlockedRatio,
  computeFirstCommitDelay,
  countReopens,
  median,
  computeTraceabilityCoverage,
  computeReviewCoverage,
  computeReworkRate,
  computeReopenRate,
  computeEscapedBugRate,
  computeBugPerStoryRatio,
  computeKnowledgeCaptureRate,
  computeDeliveryHealthIndex,
  computeStoryFrictionScore,
  computeTeamRiskScore,
} from './calculators';
import type { StoryMetrics, TeamMetrics } from '@devpilot/shared';

@Injectable()
export class MetricsEngineService {
  private readonly logger = new Logger(MetricsEngineService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Story-level metrics ──────────────────────────────────────

  async computeStoryMetrics(issueKey: string): Promise<StoryMetrics | null> {
    const issue = await this.prisma.issue.findUnique({
      where: { issueKey },
      include: {
        events: { orderBy: { timestamp: 'asc' } },
        comments: true,
        artifactLinks: true,
      },
    });

    if (!issue) return null;

    // Build status mapping
    const statusMap = await this.getStatusMap(issue.projectId);

    const transitions = extractStatusTransitions(issue.events, statusMap);
    const inProgressDate = findFirstTransitionTo(transitions, CanonicalState.IN_PROGRESS);
    const doneDate = findLastTransitionTo(transitions, CanonicalState.DONE);

    // Readiness
    const readinessFactors = computeReadinessFactors({
      summary: issue.summary,
      description: issue.description,
      acceptanceCriteria: issue.acceptanceCriteria,
      storyPoints: issue.storyPoints,
      assigneeId: issue.assigneeId,
      epicKey: issue.epicKey,
      parentKey: issue.parentKey,
      priority: issue.priority,
      labels: issue.labels,
      customFields: issue.customFields,
    });
    const readinessScore = computeReadinessScore(readinessFactors);

    // Churn
    const churnCount = computeChurnCount(issue.events, inProgressDate);
    const churnScore = computeChurnScore(issue.events, inProgressDate, doneDate);

    // Flow
    const leadTimeHours = computeLeadTime(issue.createdAt, doneDate);
    const cycleTimeHours = computeCycleTime(inProgressDate, doneDate);
    const blockedTimeHours = computeBlockedTime(transitions);
    const blockedRatio = computeBlockedRatio(blockedTimeHours, cycleTimeHours);
    const reopenCount = countReopens(transitions);

    // First commit
    const linkedCommits = issue.artifactLinks.filter((l) => l.artifactType === 'COMMIT');
    let firstCommitDate: Date | null = null;
    if (linkedCommits.length > 0) {
      const commitIds = linkedCommits.map((l) => l.artifactId);
      const commits = await this.prisma.commit.findMany({
        where: { id: { in: commitIds } },
        orderBy: { timestamp: 'asc' },
        take: 1,
      });
      if (commits.length > 0) firstCommitDate = commits[0].timestamp;
    }
    const firstCommitDelayHours = computeFirstCommitDelay(inProgressDate, firstCommitDate);

    // PR metrics
    const linkedPRs = issue.artifactLinks.filter((l) => l.artifactType === 'PULL_REQUEST');
    let firstReviewDelayHours: number | null = null;
    let mergeTimeHours: number | null = null;
    if (linkedPRs.length > 0) {
      const prIds = linkedPRs.map((l) => l.artifactId);
      const prs = await this.prisma.pullRequest.findMany({
        where: { id: { in: prIds } },
        include: { reviews: true },
      });
      for (const pr of prs) {
        const nonAuthorReviews = pr.reviews
          .filter((r) => r.reviewerId !== pr.authorId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        if (nonAuthorReviews.length > 0 && firstReviewDelayHours === null) {
          firstReviewDelayHours =
            (nonAuthorReviews[0].createdAt.getTime() - pr.createdAt.getTime()) / (1000 * 60 * 60);
        }
        if (pr.mergedAt && mergeTimeHours === null) {
          mergeTimeHours = (pr.mergedAt.getTime() - pr.createdAt.getTime()) / (1000 * 60 * 60);
        }
      }
    }

    // Docs
    const linkedDocs = issue.artifactLinks.filter(
      (l) => l.artifactType === 'WIKI_PAGE' || l.artifactType === 'WIKI_EDIT',
    );

    // Escaped bugs
    const linkedBugs = await this.prisma.issue.count({
      where: { type: 'BUG', epicKey: issue.epicKey ?? undefined, parentKey: issue.issueKey },
    });

    // Wiki edit count for clarification
    const wikiEditCount = await this.prisma.wikiEdit.count({
      where: { wikiPageId: { in: linkedDocs.map((l) => l.artifactId) } },
    });

    const clarificationIntensity = computeClarificationIntensity(
      issue.comments.length,
      wikiEditCount,
      firstCommitDelayHours,
      churnCount,
    );

    // Friction score
    const frictionInputs: Record<string, number> = {
      STORY_READINESS_SCORE: readinessScore,
      REQUIREMENT_CHURN_SCORE: churnScore,
      BLOCKED_TIME: Math.min(100, blockedTimeHours * 2), // normalize
      REOPEN_RATE: reopenCount > 0 ? 50 : 0,
      FIRST_REVIEW_DELAY: firstReviewDelayHours
        ? Math.min(100, firstReviewDelayHours * 2)
        : 0,
      UNLINKED_WORK_RATIO: linkedCommits.length === 0 && linkedPRs.length === 0 ? 80 : 0,
    };
    const { score: frictionScore, breakdown: frictionFactors } =
      computeStoryFrictionScore(frictionInputs);

    return {
      issueKey,
      readinessScore,
      readinessFactors,
      churnCount,
      churnScore,
      clarificationIntensity,
      leadTimeHours: leadTimeHours ? Math.round(leadTimeHours * 10) / 10 : undefined,
      cycleTimeHours: cycleTimeHours ? Math.round(cycleTimeHours * 10) / 10 : undefined,
      blockedTimeHours: Math.round(blockedTimeHours * 10) / 10,
      blockedRatio: Math.round(blockedRatio * 100) / 100,
      firstCommitDelayHours: firstCommitDelayHours
        ? Math.round(firstCommitDelayHours * 10) / 10
        : undefined,
      firstReviewDelayHours: firstReviewDelayHours
        ? Math.round(firstReviewDelayHours * 10) / 10
        : undefined,
      mergeTimeHours: mergeTimeHours ? Math.round(mergeTimeHours * 10) / 10 : undefined,
      commitCount: linkedCommits.length,
      prCount: linkedPRs.length,
      reviewCount: 0, // filled at team level
      linkedDocsCount: linkedDocs.length,
      traceabilityConfidence:
        linkedCommits.length + linkedPRs.length > 0
          ? Math.round(
              (linkedCommits.reduce((s, l) => s + l.confidenceScore, 0) +
                linkedPRs.reduce((s, l) => s + l.confidenceScore, 0)) /
                (linkedCommits.length + linkedPRs.length),
            )
          : 0,
      frictionScore,
      frictionFactors,
      reopenCount,
      escapedBugCount: linkedBugs,
    };
  }

  // ── Team-level metrics ───────────────────────────────────────

  async computeTeamMetrics(
    teamId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<TeamMetrics | null> {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) return null;

    const issues = await this.prisma.issue.findMany({
      where: {
        teamId,
        updatedAt: { gte: periodStart, lte: periodEnd },
      },
      include: {
        events: { orderBy: { timestamp: 'asc' } },
        comments: true,
        artifactLinks: true,
      },
    });

    const completedIssues = issues.filter((i) => i.canonicalState === CanonicalState.DONE);
    const inProgressIssues = issues.filter(
      (i) => i.canonicalState === CanonicalState.IN_PROGRESS || i.canonicalState === CanonicalState.IN_REVIEW,
    );

    // Compute per-story metrics
    const storyMetrics: StoryMetrics[] = [];
    for (const issue of issues) {
      const sm = await this.computeStoryMetrics(issue.issueKey);
      if (sm) storyMetrics.push(sm);
    }

    const throughput = completedIssues.length;
    const cycleTimes = storyMetrics.filter((s) => s.cycleTimeHours != null).map((s) => s.cycleTimeHours! / 24);
    const leadTimes = storyMetrics.filter((s) => s.leadTimeHours != null).map((s) => s.leadTimeHours! / 24);

    // Readiness
    const readyAtStartCount = storyMetrics.filter((s) => s.readinessScore >= 60).length;
    const startedWithoutReadinessCount = storyMetrics.filter((s) => s.readinessScore < 60).length;

    // Traceability
    const repos = await this.prisma.repository.findMany({ where: { teamId } });
    const repoIds = repos.map((r) => r.id);
    const totalCommits = await this.prisma.commit.count({ where: { repositoryId: { in: repoIds } } });
    const linkedCommitCount = await this.prisma.artifactLink.count({
      where: { artifactType: 'COMMIT', confidence: { in: ['HIGH', 'MEDIUM', 'MANUAL'] } },
    });
    const totalPRs = await this.prisma.pullRequest.count({ where: { repositoryId: { in: repoIds } } });
    const linkedPRCount = await this.prisma.artifactLink.count({
      where: { artifactType: 'PULL_REQUEST', confidence: { in: ['HIGH', 'MEDIUM', 'MANUAL'] } },
    });
    const totalBranches = await this.prisma.branch.count({ where: { repositoryId: { in: repoIds } } });
    const linkedBranchCount = await this.prisma.branch.count({
      where: { repositoryId: { in: repoIds }, issueKey: { not: null } },
    });

    const traceability = computeTraceabilityCoverage({
      totalCommits,
      linkedCommits: Math.min(linkedCommitCount, totalCommits),
      totalPRs,
      linkedPRs: Math.min(linkedPRCount, totalPRs),
      totalBranches,
      linkedBranches: linkedBranchCount,
      totalWikiPages: 0,
      linkedWikiPages: 0,
    });

    // Quality
    const reopenedCount = storyMetrics.reduce((s, m) => s + m.reopenCount, 0);
    const escapedBugCount = storyMetrics.reduce((s, m) => s + m.escapedBugCount, 0);
    const bugCount = await this.prisma.issue.count({
      where: { teamId, type: 'BUG', createdAt: { gte: periodStart, lte: periodEnd } },
    });

    // Knowledge
    const storiesWithDocs = storyMetrics.filter((s) => s.linkedDocsCount > 0).length;
    const knowledgeCaptureRate = computeKnowledgeCaptureRate(storiesWithDocs, throughput);

    // Composite indices
    const avgReadiness =
      storyMetrics.length > 0
        ? Math.round(storyMetrics.reduce((s, m) => s + m.readinessScore, 0) / storyMetrics.length)
        : 0;
    const avgChurn =
      storyMetrics.length > 0
        ? Math.round(storyMetrics.reduce((s, m) => s + m.churnScore, 0) / storyMetrics.length)
        : 0;
    const avgBlockedRatio =
      storyMetrics.length > 0
        ? storyMetrics.reduce((s, m) => s + m.blockedRatio, 0) / storyMetrics.length
        : 0;

    const healthInputs: Record<string, number> = {
      STORY_READINESS_SCORE: avgReadiness,
      CYCLE_TIME: cycleTimes.length > 0 ? Math.min(100, median(cycleTimes) * 5) : 50,
      BLOCKED_RATIO: avgBlockedRatio * 100,
      COMMIT_TRACEABILITY: traceability.commitTraceabilityPct,
      PR_REVIEW_COVERAGE: computeReviewCoverage([]) * 100,
      REOPEN_RATE: computeReopenRate(reopenedCount, throughput) * 100,
      KNOWLEDGE_CAPTURE_RATE: knowledgeCaptureRate * 100,
    };
    const { score: deliveryHealthIndex, breakdown: deliveryHealthFactors } =
      computeDeliveryHealthIndex(healthInputs);

    const riskInputs: Record<string, number> = {
      AGING_WIP: Math.min(100, inProgressIssues.length * 10),
      ESCAPED_BUG_RATE: computeEscapedBugRate(escapedBugCount, throughput) * 100,
      BLOCKED_RATIO: avgBlockedRatio * 100,
      FIRST_REVIEW_DELAY: 30, // placeholder – would come from PR analysis
      READY_AT_START_PCT: storyMetrics.length > 0 ? (readyAtStartCount / storyMetrics.length) * 100 : 100,
      REQUIREMENT_CHURN_SCORE: avgChurn,
    };
    const { score: teamRiskScore, breakdown: teamRiskFactors } = computeTeamRiskScore(riskInputs);

    return {
      teamId,
      teamName: team.name,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      throughput,
      medianCycleTimeDays: cycleTimes.length > 0 ? Math.round(median(cycleTimes) * 10) / 10 : 0,
      medianLeadTimeDays: leadTimes.length > 0 ? Math.round(median(leadTimes) * 10) / 10 : 0,
      wipLoad: inProgressIssues.length,
      agingWipCount: inProgressIssues.filter((i) => {
        const age = (Date.now() - i.updatedAt.getTime()) / (1000 * 60 * 60 * 24);
        return age > 14;
      }).length,
      blockedRatio: Math.round(avgBlockedRatio * 100) / 100,
      averageReadinessScore: avgReadiness,
      readyAtStartPct: storyMetrics.length > 0
        ? Math.round((readyAtStartCount / storyMetrics.length) * 100)
        : 0,
      startedWithoutReadinessCount,
      averageChurnScore: avgChurn,
      highChurnStoryCount: storyMetrics.filter((s) => s.churnScore > 50).length,
      commitTraceabilityPct: traceability.commitTraceabilityPct,
      prTraceabilityPct: traceability.prTraceabilityPct,
      branchTraceabilityPct: traceability.branchTraceabilityPct,
      wikiTraceabilityPct: traceability.wikiTraceabilityPct,
      unlinkedWorkRatio: traceability.unlinkedWorkRatio,
      prReviewCoveragePct: 0, // would compute from PR data
      medianFirstReviewDelayHours: 0,
      prReworkRate: 0,
      reopenRate: computeReopenRate(reopenedCount, throughput) * 100,
      escapedBugRate: computeEscapedBugRate(escapedBugCount, throughput) * 100,
      bugPerStoryRatio: computeBugPerStoryRatio(bugCount, throughput),
      knowledgeCaptureRate: knowledgeCaptureRate * 100,
      deliveryHealthIndex,
      deliveryHealthFactors,
      teamRiskScore,
      teamRiskFactors,
    };
  }

  // ── Helpers ──────────────────────────────────────────────────

  private async getStatusMap(projectId: string): Promise<Map<string, string>> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return new Map();

    const mappings = await this.prisma.statusMapping.findMany({
      where: { projectKey: project.key },
    });

    return new Map(mappings.map((m) => [m.externalStatus, m.canonicalState]));
  }
}
