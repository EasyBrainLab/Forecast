import { Module } from '@nestjs/common';
import { ImportUebersichtController } from './import-uebersicht.controller';
import { ImportUebersichtService } from './import-uebersicht.service';

@Module({
  controllers: [ImportUebersichtController],
  providers: [ImportUebersichtService],
  exports: [ImportUebersichtService],
})
export class ImportUebersichtModule {}
