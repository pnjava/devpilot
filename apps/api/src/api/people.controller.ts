// ──────────────────────────────────────────────────────────────
// People Controller – GET /api/people, GET /api/people/:id
// Non-surveillance: shows review/doc/collaboration contributions,
// NOT individual commit counts or per-person velocity.
// ──────────────────────────────────────────────────────────────

import { Controller, Get, Param, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FilterQueryDto } from '../common/dto';

@Controller('people')
export class PeopleController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listPeople(@Query() filters: FilterQueryDto) {
    const people = await this.prisma.person.findMany({
      include: {
        memberships: { include: { team: true } },
        _count: {
          select: {
            assignedIssues: true,
            reportedIssues: true,
            prReviews: true,
            wikiEdits: true,
          },
        },
      },
    });
    return { data: people };
  }

  @Get(':id')
  async getPersonDetail(@Param('id') id: string, @Query() filters: FilterQueryDto) {
    const person = await this.prisma.person.findUnique({
      where: { id },
      include: {
        memberships: { include: { team: true } },
      },
    });

    if (!person) return { error: 'Person not found' };

    const periodStart = filters.dateFrom
      ? new Date(filters.dateFrom)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const periodEnd = filters.dateTo ? new Date(filters.dateTo) : new Date();

    // Collaboration-focused metrics (not surveillance)
    const reviewsGiven = await this.prisma.pullRequestReview.count({
      where: {
        reviewerId: id,
        createdAt: { gte: periodStart, lte: periodEnd },
      },
    });

    const wikiEdits = await this.prisma.wikiEdit.count({
      where: {
        editorId: id,
        timestamp: { gte: periodStart, lte: periodEnd },
      },
    });

    const prComments = await this.prisma.pullRequestComment.count({
      where: {
        authorId: id,
        createdAt: { gte: periodStart, lte: periodEnd },
      },
    });

    const storiesCompleted = await this.prisma.issue.count({
      where: {
        assigneeId: id,
        canonicalState: 'DONE',
        resolvedAt: { gte: periodStart, lte: periodEnd },
      },
    });

    const storiesAssigned = await this.prisma.issue.findMany({
      where: {
        assigneeId: id,
        canonicalState: { in: ['IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'] },
      },
      select: { id: true, issueKey: true, summary: true, canonicalState: true, updatedAt: true },
    });

    return {
      data: {
        person,
        contributions: {
          reviewsGiven,
          wikiEdits,
          prComments,
          storiesCompleted,
        },
        currentWork: storiesAssigned,
      },
    };
  }
}
