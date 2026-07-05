import { Module } from '@nestjs/common';
import { TenderController } from './tender.controller';
import { TenderService } from './tender.service';
import { TenderScheduler } from './tender.scheduler';
import { TenderAnalyseController } from './tender-analyse.controller';
import { TenderAnalyseService } from './tender-analyse.service';
import { TenderAnalyseProvider } from './tender-analyse.provider';

@Module({
  controllers: [TenderController, TenderAnalyseController],
  providers: [TenderService, TenderScheduler, TenderAnalyseService, TenderAnalyseProvider],
  exports: [TenderService],
})
export class TenderModule {}
