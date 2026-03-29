// ──────────────────────────────────────────────────────────────
// Integrations Controller – POST /api/integrations/sync,
//   GET /api/integrations/status
// ──────────────────────────────────────────────────────────────

import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SyncService } from '../integrations/sync/sync.service';
import { FilterQueryDto } from '../common/dto';
import { Roles } from '../auth/roles.decorator';

@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly syncService: SyncService,
  ) {}

  @Get('status')
  async getIntegrationStatus(@Query() filters: FilterQueryDto) {
    const connections = await this.prisma.integrationConnection.findMany({
      orderBy: { createdAt: 'desc' },
    });

    const recentJobs = await this.prisma.syncJob.findMany({
      orderBy: { startedAt: 'desc' },
      take: 20,
    });

    return {
      data: {
        connections,
        recentJobs,
      },
    };
  }

  @Post('sync')
  @Roles('ADMIN', 'DELIVERY_PARTNER')
  async triggerSync(@Body() body: { orgId: string; types?: string[] }) {
    const orgId = body.orgId;
    const types = body.types ?? ['jira', 'bitbucket', 'wiki'];

    // Find integration connections for this org
    const connections = await this.prisma.integrationConnection.findMany({
      where: { organizationId: orgId, isActive: true },
    });

    const results: Record<string, unknown> = {};

    for (const conn of connections) {
      const connType = conn.type.toLowerCase();
      if (types.includes('jira') && connType === 'jira') {
        results.jira = await this.syncService.runJiraSync(conn.id);
      }
      if (types.includes('bitbucket') && connType === 'bitbucket') {
        results.bitbucket = await this.syncService.runBitbucketSync(conn.id);
      }
      if (types.includes('wiki') && connType === 'wiki') {
        results.wiki = await this.syncService.runWikiSync(conn.id);
      }
    }

    return { data: results };
  }
}
