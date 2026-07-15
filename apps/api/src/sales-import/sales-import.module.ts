import { Module } from '@nestjs/common';
import { SalesImportController } from './sales-import.controller';
import { SalesImportService } from './sales-import.service';

@Module({
  controllers: [SalesImportController],
  providers: [SalesImportService],
  exports: [SalesImportService],
})
export class SalesImportModule {}
