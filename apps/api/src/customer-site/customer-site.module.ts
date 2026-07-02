import { Module } from '@nestjs/common';
import { CustomerSiteController } from './customer-site.controller';
import { CustomerSiteService } from './customer-site.service';

@Module({
  controllers: [CustomerSiteController],
  providers: [CustomerSiteService],
  exports: [CustomerSiteService],
})
export class CustomerSiteModule {}
