import { Module } from '@nestjs/common';
import { SalesAnalytikController } from './sales-analytik.controller';
import { SalesAnalytikService } from './sales-analytik.service';

@Module({
  controllers: [SalesAnalytikController],
  providers: [SalesAnalytikService],
  exports: [SalesAnalytikService],
})
export class SalesAnalytikModule {}
