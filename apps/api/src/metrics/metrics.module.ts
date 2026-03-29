import { Module } from '@nestjs/common';
import { MetricsEngineService } from './engine.service';
import { InsightsService } from './insights.service';

@Module({
  providers: [MetricsEngineService, InsightsService],
  exports: [MetricsEngineService, InsightsService],
})
export class MetricsModule {}
