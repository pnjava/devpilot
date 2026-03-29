// ──────────────────────────────────────────────────────────────
// Admin Controller – GET/PUT /api/admin/settings, status-mappings,
//   thresholds, weights
// ──────────────────────────────────────────────────────────────

import { Controller, Get, Put, Body, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../auth/roles.decorator';

@Controller('admin')
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('settings')
  @Roles('ADMIN')
  async getSettings(@Query('orgId') orgId: string) {
    const settings = await this.prisma.organizationSettings.findFirst({
      where: orgId ? { organizationId: orgId } : undefined,
    });
    const statusMappings = await this.prisma.statusMapping.findMany({
      where: orgId ? { organizationId: orgId } : undefined,
    });
    const thresholds = settings
      ? await this.prisma.metricThresholdConfig.findMany({
          where: { settingsId: settings.id },
        })
      : [];
    const weights = settings
      ? await this.prisma.metricWeightConfig.findMany({
          where: { settingsId: settings.id },
        })
      : [];

    return {
      data: {
        settings,
        statusMappings,
        thresholds,
        weights,
      },
    };
  }

  @Put('settings')
  @Roles('ADMIN')
  async updateSettings(@Body() body: { orgId: string; data: Record<string, unknown> }) {
    const updated = await this.prisma.organizationSettings.upsert({
      where: { organizationId: body.orgId },
      update: body.data as any,
      create: { organizationId: body.orgId, ...(body.data as any) },
    });
    return { data: updated };
  }

  @Put('status-mappings')
  @Roles('ADMIN')
  async updateStatusMappings(
    @Body()
    body: {
      orgId: string;
      mappings: Array<{ externalStatus: string; canonicalState: string; projectKey?: string }>;
    },
  ) {
    const results = await Promise.all(
      body.mappings.map((m) => {
        const projectKey = m.projectKey ?? '__default__';
        return this.prisma.statusMapping.upsert({
          where: {
            organizationId_projectKey_externalStatus: {
              organizationId: body.orgId,
              projectKey,
              externalStatus: m.externalStatus,
            },
          },
          update: { canonicalState: m.canonicalState },
          create: {
            organizationId: body.orgId,
            projectKey,
            externalStatus: m.externalStatus,
            canonicalState: m.canonicalState,
          },
        });
      }),
    );
    return { data: results };
  }

  @Put('thresholds')
  @Roles('ADMIN')
  async updateThresholds(
    @Body()
    body: {
      orgId: string;
      thresholds: Array<{ metricKey: string; warningThreshold: number; criticalThreshold: number; direction?: string }>;
    },
  ) {
    const settings = await this.prisma.organizationSettings.findUnique({
      where: { organizationId: body.orgId },
    });
    if (!settings) return { error: 'Settings not found for this org' };

    const results = await Promise.all(
      body.thresholds.map((t) =>
        this.prisma.metricThresholdConfig.upsert({
          where: {
            settingsId_metricKey: {
              settingsId: settings.id,
              metricKey: t.metricKey,
            },
          },
          update: {
            warningThreshold: t.warningThreshold,
            criticalThreshold: t.criticalThreshold,
            direction: t.direction ?? 'ABOVE',
          },
          create: {
            settingsId: settings.id,
            metricKey: t.metricKey,
            warningThreshold: t.warningThreshold,
            criticalThreshold: t.criticalThreshold,
            direction: t.direction ?? 'ABOVE',
          },
        }),
      ),
    );
    return { data: results };
  }

  @Put('weights')
  @Roles('ADMIN')
  async updateWeights(
    @Body()
    body: {
      orgId: string;
      compositeMetricKey: string;
      weights: Array<{ inputMetricKey: string; weight: number }>;
    },
  ) {
    const settings = await this.prisma.organizationSettings.findUnique({
      where: { organizationId: body.orgId },
    });
    if (!settings) return { error: 'Settings not found for this org' };

    const results = await Promise.all(
      body.weights.map((w) =>
        this.prisma.metricWeightConfig.upsert({
          where: {
            settingsId_compositeMetricKey_inputMetricKey: {
              settingsId: settings.id,
              compositeMetricKey: body.compositeMetricKey,
              inputMetricKey: w.inputMetricKey,
            },
          },
          update: { weight: w.weight },
          create: {
            settingsId: settings.id,
            compositeMetricKey: body.compositeMetricKey,
            inputMetricKey: w.inputMetricKey,
            weight: w.weight,
          },
        }),
      ),
    );
    return { data: results };
  }
}
