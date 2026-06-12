import { Module } from '@nestjs/common';
import { SalesFlashController } from './sales-flash.controller';
import { SalesFlashService } from './sales-flash.service';

@Module({
  controllers: [SalesFlashController],
  providers: [SalesFlashService],
  exports: [SalesFlashService],
})
export class SalesFlashModule {}
