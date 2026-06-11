import { Module } from '@nestjs/common';
import { StammdatenController } from './stammdaten.controller';

@Module({
  controllers: [StammdatenController],
})
export class StammdatenModule {}
