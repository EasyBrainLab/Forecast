import { Module } from '@nestjs/common';
import { PlKostenController } from './pl-kosten.controller';
import { PlKostenImportService } from './pl-kosten-import.service';

@Module({
  controllers: [PlKostenController],
  providers: [PlKostenImportService],
})
export class PlKostenModule {}
