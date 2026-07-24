import { Module } from '@nestjs/common';
import { PlKostenController } from './pl-kosten.controller';
import { GuvImportService } from './guv-import.service';

@Module({
  controllers: [PlKostenController],
  providers: [GuvImportService],
})
export class PlKostenModule {}
