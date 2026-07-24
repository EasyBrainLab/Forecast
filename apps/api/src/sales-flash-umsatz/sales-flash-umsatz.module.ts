import { Module } from '@nestjs/common';
import { SalesFlashUmsatzController } from './sales-flash-umsatz.controller';
import { SalesFlashUmsatzImportService } from './sales-flash-umsatz-import.service';

@Module({
  controllers: [SalesFlashUmsatzController],
  providers: [SalesFlashUmsatzImportService],
})
export class SalesFlashUmsatzModule {}
