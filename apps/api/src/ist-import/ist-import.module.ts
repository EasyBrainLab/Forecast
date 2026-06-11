import { Module } from '@nestjs/common';
import { IstImportController } from './ist-import.controller';
import { IstImportService } from './ist-import.service';

@Module({
  controllers: [IstImportController],
  providers: [IstImportService],
  exports: [IstImportService],
})
export class IstImportModule {}
