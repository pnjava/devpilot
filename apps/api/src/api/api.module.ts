// ──────────────────────────────────────────────────────────────
// Api Module – registers all REST controllers
// ──────────────────────────────────────────────────────────────

import { Module } from '@nestjs/common';
import { MetricsModule } from '../metrics/metrics.module';
import { TraceabilityModule } from '../traceability/traceability.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { OverviewController } from './overview.controller';
import { TeamsController } from './teams.controller';
import { StoriesController } from './stories.controller';
import { PeopleController } from './people.controller';
import { ReposController } from './repos.controller';
import { AlertsController } from './alerts.controller';
import { IntegrationsController } from './integrations.controller';
import { LinksController } from './links.controller';
import { AdminController } from './admin.controller';

@Module({
  imports: [MetricsModule, TraceabilityModule, IntegrationsModule],
  controllers: [
    OverviewController,
    TeamsController,
    StoriesController,
    PeopleController,
    ReposController,
    AlertsController,
    IntegrationsController,
    LinksController,
    AdminController,
  ],
})
export class ApiModule {}
