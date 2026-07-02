import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ALLE_ROLLEN, Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { CustomerSiteService } from './customer-site.service';

const TYP_WERTE = ['OEFFENTLICH', 'PRIVAT', 'UNBEKANNT'];
const STATUS_WERTE = ['NEU', 'AKTIV', 'GEFAEHRDET', 'VERLOREN', 'ZURUECKGEWONNEN'];

class SiteUpsertDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  stadt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  landIso?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  regionCode?: string;

  @IsOptional()
  @IsIn(TYP_WERTE)
  typ?: string;

  @IsOptional()
  @IsIn(STATUS_WERTE)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notiz?: string;
}

class StatusDto {
  @IsIn(STATUS_WERTE)
  status!: string;
}

class ZuordnenDto {
  @IsString()
  @MaxLength(200)
  kunde!: string;

  @IsOptional()
  @IsString()
  zielSiteId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  regionCode?: string;

  @IsOptional()
  @IsIn(TYP_WERTE)
  typ?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  stadt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  landIso?: string;
}

@ApiTags('customer-site')
@ApiBearerAuth()
@Controller('customer-site')
export class CustomerSiteController {
  constructor(private readonly service: CustomerSiteService) {}

  @Roles(...ALLE_ROLLEN)
  @Get()
  liste(@CurrentUser() aktor: RequestUser, @Query('status') status?: string) {
    return this.service.liste(aktor, status);
  }

  // Statische Route vor der Parameter-Route (:id), sonst würde "vorschlaege" als id gematcht.
  @Roles('ADMIN', 'SUPPORT')
  @Get('vorschlaege')
  vorschlaege() {
    return this.service.vorschlaege();
  }

  @Roles(...ALLE_ROLLEN)
  @Get(':id')
  holen(@Param('id') id: string, @CurrentUser() aktor: RequestUser) {
    return this.service.holen(id, aktor);
  }

  @Roles('ADMIN')
  @Post()
  erstellen(@Body() dto: SiteUpsertDto, @CurrentUser() aktor: RequestUser) {
    return this.service.erstellen(dto, aktor);
  }

  @Roles('ADMIN')
  @Post('zuordnen')
  zuordnen(@Body() dto: ZuordnenDto, @CurrentUser() aktor: RequestUser) {
    return this.service.zuordnen(dto, aktor);
  }

  @Roles('ADMIN', 'BU_LEITER', 'VERTRIEBSLEITER', 'AGM')
  @Post(':id/status')
  status(@Param('id') id: string, @Body() dto: StatusDto, @CurrentUser() aktor: RequestUser) {
    return this.service.statusSetzen(id, dto.status, aktor);
  }

  @Roles('ADMIN')
  @Put(':id')
  aktualisieren(@Param('id') id: string, @Body() dto: SiteUpsertDto, @CurrentUser() aktor: RequestUser) {
    return this.service.aktualisieren(id, dto, aktor);
  }

  @Roles('ADMIN')
  @Delete(':id')
  loeschen(@Param('id') id: string, @CurrentUser() aktor: RequestUser) {
    return this.service.loeschen(id, aktor);
  }
}
