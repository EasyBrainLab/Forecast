import { Module } from '@nestjs/common';
import { AbsatzController } from './absatz.controller';
import { AbsatzService } from './absatz.service';
import { AbsatzImportService } from './absatz-import.service';
import { KundeRegionService } from './kunde-region.service';

@Module({
  controllers: [AbsatzController],
  providers: [AbsatzService, AbsatzImportService, KundeRegionService],
  exports: [AbsatzService, AbsatzImportService, KundeRegionService],
})
export class AbsatzModule {}
