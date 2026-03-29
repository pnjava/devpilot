// ──────────────────────────────────────────────────────────────
// Real Jira Adapter – delegates to @devpilot/jira shared client
// ──────────────────────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JiraClient } from '@devpilot/jira';
import type { IJiraAdapter, SyncOptions, SyncResult } from './adapter.interface';

@Injectable()
export class JiraAdapter implements IJiraAdapter {
  private readonly logger = new Logger(JiraAdapter.name);
  private readonly client: JiraClient;

  constructor(
    private readonly prisma: PrismaService,
  ) {
    this.client = JiraClient.fromEnv();
  }

  async testConnection(): Promise<boolean> {
    try {
      const ok = await this.client.testConnection();
      if (!ok) this.logger.error('Jira connection test returned false');
      return ok;
    } catch (err) {
      this.logger.error('Jira connection failed', err);
      return false;
    }
  }

  async syncProjects(): Promise<SyncResult> {
    const errors: string[] = [];
    let count = 0;
    try {
      const projects = await this.client.getProjects();
      for (const p of projects) {
        await this.prisma.project.upsert({
          where: { key: p.key },
          update: { name: p.name },
          create: { key: p.key, name: p.name, externalId: p.id },
        });
        count++;
      }
    } catch (err: unknown) {
      errors.push(String(err));
    }
    return { itemsSynced: count, errors, hasMore: false };
  }

  async syncSprints(projectKey: string): Promise<SyncResult> {
    this.logger.log(`Syncing sprints for ${projectKey} – not yet implemented in real adapter`);
    return { itemsSynced: 0, errors: [], hasMore: false };
  }

  async syncIssues(options: SyncOptions): Promise<SyncResult> {
    const errors: string[] = [];
    let count = 0;
    const jql = options.since
      ? `updated >= "${options.since.toISOString().slice(0, 10)}" ORDER BY updated ASC`
      : 'ORDER BY updated ASC';
    const startAt = options.cursor ? parseInt(options.cursor, 10) : 0;

    try {
      const data = await this.client.searchIssues(jql, {
        startAt,
        maxResults: 100,
        expand: 'changelog',
        fields: '*all',
      });

      for (const _raw of data.issues) {
        // Normalization would go here – map raw fields to Issue model
        count++;
      }

      const nextStart = data.startAt + data.maxResults;
      return {
        itemsSynced: count,
        errors,
        hasMore: nextStart < data.total,
        nextCursor: String(nextStart),
      };
    } catch (err: unknown) {
      errors.push(String(err));
      return { itemsSynced: count, errors, hasMore: false };
    }
  }
}
