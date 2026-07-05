import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, Max, Min } from 'class-validator';
import { ALLE_ROLLEN, Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { ReportService } from './report.service';

const ABSCHNITTE = ['KRITISCH', 'IMPLANTATION', 'AKTIVITAET_NEUKUNDE', 'AKTIVITAET_BESTAND', 'MARKETING', 'PROJEKT', 'NAECHSTE_AKTIVITAET', 'WETTBEWERB'];

class KopfDto {
  @IsOptional()
  @IsNumber()
  forecastFolgemonatEur?: number;

  @IsOptional()
  @IsNumber()
  forecastQuartalEur?: number;

  @IsOptional()
  @IsBoolean()
  wettbewerbKeineAenderung?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  marktAllgemein?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  personal?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  sonstiges?: string;
}

class EintragDto {
  @IsIn(ABSCHNITTE)
  abschnitt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  typ?: string;

  @IsOptional()
  @IsString()
  customerSiteId?: string;

  @IsOptional()
  @IsString()
  competitorId?: string;

  @IsOptional()
  @IsString()
  tenderId?: string;

  @IsOptional()
  @IsString()
  e1Id?: string;

  @IsOptional()
  @IsString()
  datum?: string;

  @IsString()
  @MaxLength(4000)
  beschreibung!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  ergebnis?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  landIso?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  stadt?: string;

  @IsOptional()
  @IsNumber()
  erwarteterUmsatzEur?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  wahrscheinlichkeit?: number;

  @IsOptional()
  @IsNumber()
  kostenEur?: number;

  @IsOptional()
  @IsNumber()
  menge?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  preisInfo?: string;
}

@ApiTags('report')
@ApiBearerAuth()
@Controller('report')
export class ReportController {
  constructor(private readonly service: ReportService) {}

  @Roles(...ALLE_ROLLEN)
  @Get('periode/:periode')
  fuerPeriode(@Param('periode') periode: string, @CurrentUser() aktor: RequestUser) {
    return this.service.fuerPeriode(periode, aktor);
  }

  @Roles(...ALLE_ROLLEN)
  @Get('zahlen/:periode/:regionCode')
  zahlen(@Param('periode') periode: string, @Param('regionCode') regionCode: string, @CurrentUser() aktor: RequestUser) {
    return this.service.zahlen(periode, regionCode, aktor);
  }

  @Roles('VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT')
  @Get('board/:periode')
  board(@Param('periode') periode: string, @CurrentUser() aktor: RequestUser) {
    return this.service.board(periode, aktor);
  }

  @Roles('AGM', 'ADMIN')
  @Put('periode/:periode/region/:regionCode')
  speichern(@Param('periode') periode: string, @Param('regionCode') regionCode: string, @Body() dto: KopfDto, @CurrentUser() aktor: RequestUser) {
    return this.service.speichernKopf(periode, regionCode, dto, aktor);
  }

  @Roles('AGM', 'ADMIN')
  @Post('periode/:periode/region/:regionCode/eintraege')
  eintragAnlegen(@Param('periode') periode: string, @Param('regionCode') regionCode: string, @Body() dto: EintragDto, @CurrentUser() aktor: RequestUser) {
    return this.service.eintragAnlegen(periode, regionCode, dto, aktor);
  }

  @Roles('AGM', 'ADMIN')
  @Delete('eintrag/:id')
  eintragLoeschen(@Param('id') id: string, @CurrentUser() aktor: RequestUser) {
    return this.service.eintragLoeschen(id, aktor);
  }

  @Roles('AGM', 'ADMIN')
  @Post('periode/:periode/region/:regionCode/einreichen')
  einreichen(@Param('periode') periode: string, @Param('regionCode') regionCode: string, @CurrentUser() aktor: RequestUser) {
    return this.service.einreichen(periode, regionCode, aktor);
  }

  @Roles('AGM', 'ADMIN')
  @Post('periode/:periode/region/:regionCode/zuruecksetzen')
  zuruecksetzen(@Param('periode') periode: string, @Param('regionCode') regionCode: string, @CurrentUser() aktor: RequestUser) {
    return this.service.zuruecksetzen(periode, regionCode, aktor);
  }

  @Roles('VERTRIEBSLEITER', 'BU_LEITER')
  @Post('periode/:periode/region/:regionCode/gelesen')
  gelesen(@Param('periode') periode: string, @Param('regionCode') regionCode: string, @CurrentUser() aktor: RequestUser) {
    return this.service.gelesen(periode, regionCode, aktor);
  }
}
