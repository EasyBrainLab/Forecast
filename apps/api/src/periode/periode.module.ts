import { Module } from '@nestjs/common';
import { DashboardModule } from '../dashboard/dashboard.module';
import { PeriodeController } from './periode.controller';
import { PeriodeService } from './periode.service';

@Module({
  imports: [DashboardModule],
  controllers: [PeriodeController],
  providers: [PeriodeService],
  exports: [PeriodeService],
})
export class PeriodeModule {}
