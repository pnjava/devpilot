import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { JIRA_ADAPTER, BITBUCKET_ADAPTER, WIKI_ADAPTER } from './adapters/adapter.interface';
import { JiraMockAdapter } from './adapters/jira-mock.adapter';
import { JiraAdapter } from './adapters/jira.adapter';
import { BitbucketMockAdapter } from './adapters/bitbucket-mock.adapter';
import { BitbucketAdapter } from './adapters/bitbucket.adapter';
import { WikiMockAdapter } from './adapters/wiki-mock.adapter';
import { WikiAdapter } from './adapters/wiki.adapter';
import { SyncService } from './sync/sync.service';

@Module({
  providers: [
    SyncService,
    {
      provide: JIRA_ADAPTER,
      useFactory: (config: ConfigService, prisma: PrismaService) => {
        return config.get('USE_MOCK_ADAPTERS') === 'true'
          ? new JiraMockAdapter(prisma)
          : new JiraAdapter(prisma);
      },
      inject: [ConfigService, PrismaService],
    },
    {
      provide: BITBUCKET_ADAPTER,
      useFactory: (config: ConfigService, prisma: PrismaService) => {
        return config.get('USE_MOCK_ADAPTERS') === 'true'
          ? new BitbucketMockAdapter()
          : new BitbucketAdapter(config, prisma);
      },
      inject: [ConfigService, PrismaService],
    },
    {
      provide: WIKI_ADAPTER,
      useFactory: (config: ConfigService) => {
        return config.get('USE_MOCK_ADAPTERS') === 'true'
          ? new WikiMockAdapter()
          : new WikiAdapter(config);
      },
      inject: [ConfigService],
    },
  ],
  exports: [JIRA_ADAPTER, BITBUCKET_ADAPTER, WIKI_ADAPTER, SyncService],
})
export class IntegrationsModule {}
