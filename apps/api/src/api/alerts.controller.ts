// ──────────────────────────────────────────────────────────────
// Alerts Controller – GET /api/alerts
// ──────────────────────────────────────────────────────────────

import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FilterQueryDto } from '../common/dto';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listAlerts(@Query() filters: FilterQueryDto) {
    const where: Record<string, unknown> = {};

    if (filters.teamId) where.teamId = filters.teamId;

    const alerts = await this.prisma.alert.findMany({
      where,
      include: {
        team: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return { data: alerts };
  }

  @Patch(':id/acknowledge')
  async acknowledgeAlert(@Param('id') id: string) {
    const alert = await this.prisma.alert.update({
      where: { id },
      data: { isActive: false, resolvedAt: new Date() },
    });
    return { data: alert };
  }
}
