import { Module } from '@nestjs/common';
import { BridgeService } from './bridge.service';
import { BridgeController } from './bridge.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [BridgeService],
  controllers: [BridgeController],
  exports: [BridgeService],
})
export class BridgeModule {}
