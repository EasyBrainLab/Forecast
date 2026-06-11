import { Module } from '@nestjs/common';
import { ForecastController } from './forecast.controller';
import { ForecastService } from './forecast.service';
import { ForecastScheduler } from './forecast.scheduler';

@Module({
  controllers: [ForecastController],
  providers: [ForecastService, ForecastScheduler],
  exports: [ForecastService],
})
export class ForecastModule {}
