import { Module } from '@nestjs/common';
import { AbsatzController } from './absatz.controller';
import { AbsatzService } from './absatz.service';
import { AbsatzImportService } from './absatz-import.service';

@Module({
  controllers: [AbsatzController],
  providers: [AbsatzService, AbsatzImportService],
  exports: [AbsatzService, AbsatzImportService],
})
export class AbsatzModule {}
