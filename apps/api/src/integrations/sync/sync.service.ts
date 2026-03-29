// ──────────────────────────────────────────────────────────────
// Sync Service – orchestrates full/incremental sync jobs
// ──────────────────────────────────────────────────────────────

import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  JIRA_ADAPTER,
  BITBUCKET_ADAPTER,
  WIKI_ADAPTER,
  type IJiraAdapter,
  type IBitbucketAdapter,
  type IWikiAdapter,
} from '../adapters/adapter.interface';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(JIRA_ADAPTER) private readonly jira: IJiraAdapter,
    @Inject(BITBUCKET_ADAPTER) private readonly bitbucket: IBitbucketAdapter,
    @Inject(WIKI_ADAPTER) private readonly wiki: IWikiAdapter,
  ) {}

  async runJiraSync(connectionId: string, full = false) {
    const job = await this.prisma.syncJob.create({
      data: { connectionId, type: full ? 'FULL' : 'INCREMENTAL', status: 'RUNNING' },
    });

    try {
      const projResult = await this.jira.syncProjects();
      const issueResult = await this.jira.syncIssues({ fullSync: full });
      const total = projResult.itemsSynced + issueResult.itemsSynced;
      const errors = [...projResult.errors, ...issueResult.errors];

      await this.prisma.syncJob.update({
        where: { id: job.id },
        data: {
          status: errors.length > 0 ? 'PARTIAL' : 'COMPLETED',
          completedAt: new Date(),
          itemsSynced: total,
          errors,
          cursor: issueResult.nextCursor,
        },
      });

      await this.prisma.integrationConnection.update({
        where: { id: connectionId },
        data: {
          lastSyncAt: new Date(),
          lastSyncStatus: errors.length > 0 ? 'PARTIAL' : 'COMPLETED',
        },
      });

      this.logger.log(`Jira sync complete: ${total} items, ${errors.length} errors`);
    } catch (err: unknown) {
      await this.prisma.syncJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', completedAt: new Date(), errors: [String(err)] },
      });
      this.logger.error('Jira sync failed', err);
    }
  }

  async runBitbucketSync(connectionId: string, full = false) {
    const job = await this.prisma.syncJob.create({
      data: { connectionId, type: full ? 'FULL' : 'INCREMENTAL', status: 'RUNNING' },
    });

    try {
      const result = await this.bitbucket.syncRepositories({ fullSync: full });
      await this.prisma.syncJob.update({
        where: { id: job.id },
        data: {
          status: result.errors.length > 0 ? 'PARTIAL' : 'COMPLETED',
          completedAt: new Date(),
          itemsSynced: result.itemsSynced,
          errors: result.errors,
        },
      });
      this.logger.log(`Bitbucket sync complete: ${result.itemsSynced} items`);
    } catch (err: unknown) {
      await this.prisma.syncJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', completedAt: new Date(), errors: [String(err)] },
      });
      this.logger.error('Bitbucket sync failed', err);
    }
  }

  async runWikiSync(connectionId: string, full = false) {
    const job = await this.prisma.syncJob.create({
      data: { connectionId, type: full ? 'FULL' : 'INCREMENTAL', status: 'RUNNING' },
    });

    try {
      const result = await this.wiki.syncPages({ fullSync: full });
      await this.prisma.syncJob.update({
        where: { id: job.id },
        data: {
          status: result.errors.length > 0 ? 'PARTIAL' : 'COMPLETED',
          completedAt: new Date(),
          itemsSynced: result.itemsSynced,
          errors: result.errors,
        },
      });
      this.logger.log(`Wiki sync complete: ${result.itemsSynced} items`);
    } catch (err: unknown) {
      await this.prisma.syncJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', completedAt: new Date(), errors: [String(err)] },
      });
      this.logger.error('Wiki sync failed', err);
    }
  }
}
