import { Module } from '@nestjs/common';
import { AgmStatementController } from './agm-statement.controller';
import { AgmStatementService } from './agm-statement.service';

@Module({
  controllers: [AgmStatementController],
  providers: [AgmStatementService],
  exports: [AgmStatementService],
})
export class AgmStatementModule {}
