import { Module } from '@nestjs/common';
import { PlKostenController } from './pl-kosten.controller';
import { PlKostenImportService } from './pl-kosten-import.service';
import { GuvImportService } from './guv-import.service';

@Module({
  controllers: [PlKostenController],
  providers: [PlKostenImportService, GuvImportService],
})
export class PlKostenModule {}
