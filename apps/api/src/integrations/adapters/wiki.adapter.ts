// ──────────────────────────────────────────────────────────────
// Real Wiki / Confluence Adapter (skeleton)
// ──────────────────────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IWikiAdapter, SyncOptions, SyncResult } from './adapter.interface';

@Injectable()
export class WikiAdapter implements IWikiAdapter {
  private readonly logger = new Logger(WikiAdapter.name);
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.getOrThrow<string>('WIKI_BASE_URL');
    const email = this.config.getOrThrow<string>('WIKI_EMAIL');
    const token = this.config.getOrThrow<string>('WIKI_API_TOKEN');
    this.authHeader = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
  }

  async testConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/rest/api/space?limit=1`, {
        headers: { Authorization: this.authHeader, Accept: 'application/json' },
      });
      return res.ok;
    } catch (err) {
      this.logger.error('Wiki connection failed', err);
      return false;
    }
  }

  async syncPages(_options: SyncOptions): Promise<SyncResult> {
    this.logger.log('Wiki sync – skeleton');
    return { itemsSynced: 0, errors: [], hasMore: false };
  }

  async syncEdits(_pageId: string): Promise<SyncResult> {
    return { itemsSynced: 0, errors: [], hasMore: false };
  }
}
