// ──────────────────────────────────────────────────────────────
// Real Bitbucket Adapter (skeleton – Bitbucket Cloud REST API 2.0)
// ──────────────────────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import type { IBitbucketAdapter, SyncOptions, SyncResult } from './adapter.interface';

@Injectable()
export class BitbucketAdapter implements IBitbucketAdapter {
  private readonly logger = new Logger(BitbucketAdapter.name);
  private readonly baseUrl: string;
  private readonly workspace: string;
  private readonly authHeader: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.baseUrl = this.config.getOrThrow<string>('BITBUCKET_BASE_URL');
    this.workspace = this.config.getOrThrow<string>('BITBUCKET_WORKSPACE');
    const user = this.config.getOrThrow<string>('BITBUCKET_USERNAME');
    const pass = this.config.getOrThrow<string>('BITBUCKET_APP_PASSWORD');
    this.authHeader = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  }

  private async bbFetch<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      headers: { Authorization: this.authHeader, Accept: 'application/json' },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Bitbucket API error ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.bbFetch(`/repositories/${this.workspace}?pagelen=1`);
      return true;
    } catch (err) {
      this.logger.error('Bitbucket connection failed', err);
      return false;
    }
  }

  async syncRepositories(_options: SyncOptions): Promise<SyncResult> {
    this.logger.log('Syncing Bitbucket repos – skeleton');
    return { itemsSynced: 0, errors: [], hasMore: false };
  }

  async syncCommits(_repoSlug: string, _options: SyncOptions): Promise<SyncResult> {
    return { itemsSynced: 0, errors: [], hasMore: false };
  }

  async syncPullRequests(_repoSlug: string, _options: SyncOptions): Promise<SyncResult> {
    return { itemsSynced: 0, errors: [], hasMore: false };
  }

  async syncBranches(_repoSlug: string): Promise<SyncResult> {
    return { itemsSynced: 0, errors: [], hasMore: false };
  }
}
