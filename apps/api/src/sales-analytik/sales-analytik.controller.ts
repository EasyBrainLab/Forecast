import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { SalesAnalytikService, type Richtung } from './sales-analytik.service';

@ApiTags('sales-analytik')
@ApiBearerAuth()
@Controller('sales-analytik')
@Roles('VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN')
export class SalesAnalytikController {
  constructor(private readonly service: SalesAnalytikService) {}

  @Roles('VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN')
  @Get('filteroptionen')
  filteroptionen() {
    return this.service.filteroptionen();
  }

  @Roles('VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN')
  @Get('kunden')
  kunden() {
    return this.service.kunden();
  }

  @Roles('VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN')
  @Get('produkte')
  produkte() {
    return this.service.produkte();
  }

  @Roles('VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN')
  @Get('preisstabilitaet')
  preisstabilitaet(
    @Query('jahre') jahre?: string,
    @Query('toleranzProzent') toleranzProzent?: string,
    @Query('produktnummer') produktnummer?: string,
    @Query('waehrung') waehrung?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.preisstabilitaet({ jahre: Number(jahre), toleranzProzent: Number(toleranzProzent), produktnummer, waehrung, limit: Number(limit) });
  }

  @Roles('VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN')
  @Get('umsatzveraenderung')
  umsatzveraenderung(
    @Query('jahrVon') jahrVon?: string,
    @Query('jahrBis') jahrBis?: string,
    @Query('richtung') richtung?: string,
    @Query('waehrung') waehrung?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.umsatzveraenderung({ jahrVon: Number(jahrVon), jahrBis: Number(jahrBis), richtung: richtung as Richtung, waehrung, limit: Number(limit) });
  }

  @Roles('VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN')
  @Get('kundenzeitreihe')
  kundenzeitreihe(
    @Query('dataAreaId') dataAreaId: string,
    @Query('kundennummer') kundennummer: string,
    @Query('produktnummer') produktnummer?: string,
    @Query('waehrung') waehrung?: string,
  ) {
    return this.service.kundenzeitreihe({ dataAreaId, kundennummer, produktnummer, waehrung });
  }

  @Roles('VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN')
  @Get('mengentrend')
  mengentrend(
    @Query('jahrVon') jahrVon?: string,
    @Query('jahrBis') jahrBis?: string,
    @Query('dimension') dimension?: string,
    @Query('richtung') richtung?: string,
    @Query('waehrung') waehrung?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.mengentrend({ jahrVon: Number(jahrVon), jahrBis: Number(jahrBis), dimension: dimension === 'produkt' ? 'produkt' : 'kunde', richtung: richtung as Richtung, waehrung, limit: Number(limit) });
  }
}
