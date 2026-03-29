import { Module } from '@nestjs/common';
import { LinkingService } from './linking.service';

@Module({
  providers: [LinkingService],
  exports: [LinkingService],
})
export class TraceabilityModule {}
