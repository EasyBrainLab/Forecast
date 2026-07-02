import { Module } from '@nestjs/common';
import { CompetitorController } from './competitor.controller';

@Module({
  controllers: [CompetitorController],
})
export class CompetitorModule {}
