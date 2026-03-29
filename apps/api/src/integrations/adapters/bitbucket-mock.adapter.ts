// ──────────────────────────────────────────────────────────────
// Mock Bitbucket Adapter
// ──────────────────────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import type { IBitbucketAdapter, SyncOptions, SyncResult } from './adapter.interface';

@Injectable()
export class BitbucketMockAdapter implements IBitbucketAdapter {
  private readonly logger = new Logger(BitbucketMockAdapter.name);

  async testConnection(): Promise<boolean> {
    this.logger.log('Mock Bitbucket: connection OK');
    return true;
  }

  async syncRepositories(_options: SyncOptions): Promise<SyncResult> {
    this.logger.log('Mock Bitbucket: repos created via seed');
    return { itemsSynced: 0, errors: [], hasMore: false };
  }

  async syncCommits(_repoSlug: string, _options: SyncOptions): Promise<SyncResult> {
    this.logger.log('Mock Bitbucket: commits created via seed');
    return { itemsSynced: 0, errors: [], hasMore: false };
  }

  async syncPullRequests(_repoSlug: string, _options: SyncOptions): Promise<SyncResult> {
    this.logger.log('Mock Bitbucket: PRs created via seed');
    return { itemsSynced: 0, errors: [], hasMore: false };
  }

  async syncBranches(_repoSlug: string): Promise<SyncResult> {
    this.logger.log('Mock Bitbucket: branches created via seed');
    return { itemsSynced: 0, errors: [], hasMore: false };
  }
}
