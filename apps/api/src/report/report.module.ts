import { Module } from '@nestjs/common';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { ReportScheduler } from './report.scheduler';

@Module({
  controllers: [ReportController],
  providers: [ReportService, ReportScheduler],
  exports: [ReportService],
})
export class ReportModule {}
