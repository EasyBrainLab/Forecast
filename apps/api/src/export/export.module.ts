import { Module } from '@nestjs/common';
import { DashboardModule } from '../dashboard/dashboard.module';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

@Module({
  imports: [DashboardModule],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
