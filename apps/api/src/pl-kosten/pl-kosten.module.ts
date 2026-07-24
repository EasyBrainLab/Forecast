import { Module } from '@nestjs/common';
import { PlKostenController } from './pl-kosten.controller';
import { GuvImportService } from './guv-import.service';
import { GuvPlanService } from './guv-plan.service';

@Module({
  controllers: [PlKostenController],
  providers: [GuvImportService, GuvPlanService],
})
export class PlKostenModule {}
