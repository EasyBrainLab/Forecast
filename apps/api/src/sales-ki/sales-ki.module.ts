import { Module } from '@nestjs/common';
import { SalesAnalytikModule } from '../sales-analytik/sales-analytik.module';
import { SalesKiController } from './sales-ki.controller';
import { SalesKiService } from './sales-ki.service';
import { SalesFrageProvider } from './sales-frage.provider';

@Module({
  imports: [SalesAnalytikModule],
  controllers: [SalesKiController],
  providers: [SalesKiService, SalesFrageProvider],
})
export class SalesKiModule {}
