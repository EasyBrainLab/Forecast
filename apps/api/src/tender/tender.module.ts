import { Module } from '@nestjs/common';
import { TenderController } from './tender.controller';
import { TenderService } from './tender.service';
import { TenderScheduler } from './tender.scheduler';

@Module({
  controllers: [TenderController],
  providers: [TenderService, TenderScheduler],
  exports: [TenderService],
})
export class TenderModule {}
