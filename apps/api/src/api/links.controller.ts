// ──────────────────────────────────────────────────────────────
// Links Controller – POST /api/links/manual, DELETE /api/links/:id
// ──────────────────────────────────────────────────────────────

import { Controller, Post, Delete, Param, Body } from '@nestjs/common';
import { LinkingService } from '../traceability/linking.service';
import { CreateManualLinkDto } from '../common/dto';
import { Roles } from '../auth/roles.decorator';

@Controller('links')
export class LinksController {
  constructor(private readonly linkingService: LinkingService) {}

  @Post('manual')
  @Roles('ADMIN', 'DELIVERY_PARTNER', 'ENGINEERING_MANAGER', 'TEAM_LEAD')
  async createManualLink(@Body() body: CreateManualLinkDto) {
    const link = await this.linkingService.createManualLink(
      body.issueKey,
      body.artifactType,
      body.artifactId,
      '', // authorId not in DTO; could be extracted from auth context
      body.reason,
    );
    return { data: link };
  }

  @Delete(':id')
  @Roles('ADMIN', 'DELIVERY_PARTNER')
  async removeLink(@Param('id') id: string) {
    await this.linkingService.removeLink(id);
    return { data: { deleted: true } };
  }
}
