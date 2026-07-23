import { Module } from '@nestjs/common';
import { LiefermengeController } from './liefermenge.controller';
import { LiefermengeService } from './liefermenge.service';
import { LiefermengeImportService } from './liefermenge-import.service';

@Module({
  controllers: [LiefermengeController],
  providers: [LiefermengeService, LiefermengeImportService],
  exports: [LiefermengeService],
})
export class LiefermengeModule {}
