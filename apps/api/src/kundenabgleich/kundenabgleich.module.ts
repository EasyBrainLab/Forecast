import { Module } from '@nestjs/common';
import { KundenabgleichController } from './kundenabgleich.controller';
import { KundenabgleichService } from './kundenabgleich.service';

@Module({
  controllers: [KundenabgleichController],
  providers: [KundenabgleichService],
  exports: [KundenabgleichService],
})
export class KundenabgleichModule {}
