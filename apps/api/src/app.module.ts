import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { TraceabilityModule } from './traceability/traceability.module';
import { MetricsModule } from './metrics/metrics.module';
import { ApiModule } from './api/api.module';
import { AuthModule } from './auth/auth.module';
import { BridgeModule } from './bridge/bridge.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    IntegrationsModule,
    TraceabilityModule,
    MetricsModule,
    ApiModule,
    BridgeModule,
  ],
})
export class AppModule {}
