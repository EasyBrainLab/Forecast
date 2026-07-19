import { Module } from '@nestjs/common';
import { DashboardModule } from '../dashboard/dashboard.module';
import { ForecastModule } from '../forecast/forecast.module';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

@Module({
  imports: [DashboardModule, ForecastModule],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
