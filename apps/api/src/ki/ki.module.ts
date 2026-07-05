import { Global, Module } from '@nestjs/common';
import { KiController } from './ki.controller';
import { KiConfigService } from './ki-config.service';

// Global: KiConfigService wird von Voice- und Tender-Analyse-Providern konsumiert.
@Global()
@Module({
  controllers: [KiController],
  providers: [KiConfigService],
  exports: [KiConfigService],
})
export class KiModule {}
