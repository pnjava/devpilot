// ──────────────────────────────────────────────────────────────
// Mock Wiki / Confluence Adapter
// ──────────────────────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import type { IWikiAdapter, SyncOptions, SyncResult } from './adapter.interface';

@Injectable()
export class WikiMockAdapter implements IWikiAdapter {
  private readonly logger = new Logger(WikiMockAdapter.name);

  async testConnection(): Promise<boolean> {
    this.logger.log('Mock Wiki: connection OK');
    return true;
  }

  async syncPages(_options: SyncOptions): Promise<SyncResult> {
    this.logger.log('Mock Wiki: pages created via seed');
    return { itemsSynced: 0, errors: [], hasMore: false };
  }

  async syncEdits(_pageId: string): Promise<SyncResult> {
    this.logger.log('Mock Wiki: edits created via seed');
    return { itemsSynced: 0, errors: [], hasMore: false };
  }
}
