import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { ALLE_ROLLEN, Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';

class SondereffektDto {
  @IsBoolean()
  istSondereffekt!: boolean;

  @IsOptional()
  @IsString()
  grund?: string;
}

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Roles('VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN')
  @Get('konsolidierung')
  konsolidierung(@Query('jahr') jahr: string, @Query('bereinigt') bereinigt: string, @CurrentUser() aktor: RequestUser) {
    return this.service.konsolidierung(Number(jahr) || new Date().getUTCFullYear(), aktor, bereinigt === 'true');
  }

  @Roles('VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN')
  @Get('konsolidierung-monatlich')
  konsolidierungMonatlich(@Query('jahr') jahr: string, @CurrentUser() aktor: RequestUser) {
    return this.service.konsolidierungMonatlich(Number(jahr) || new Date().getUTCFullYear(), aktor);
  }

  private j(q?: string): number {
    return Number(q) || new Date().getUTCFullYear();
  }

  @Roles(...ALLE_ROLLEN)
  @Get('kpi')
  kpi(@Query('jahr') jahr: string, @CurrentUser() aktor: RequestUser) {
    return this.service.kpi(this.j(jahr), aktor);
  }

  /** Vertriebs-KPI je Region (mit AGM-Label): Zeitraum vs. Vorjahr & Budget, YEE, 3-Jahres-Achse. */
  @Roles('VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN')
  @Get('kpi-vertrieb')
  kpiVertrieb(@Query('jahr') jahr: string, @Query('monatVon') monatVon: string, @Query('monatBis') monatBis: string, @CurrentUser() aktor: RequestUser) {
    return this.service.kpiVertrieb(this.j(jahr), Number(monatVon) || 1, Number(monatBis) || 12, aktor);
  }

  @Roles(...ALLE_ROLLEN)
  @Get('uebersicht')
  uebersicht(@CurrentUser() aktor: RequestUser) {
    return this.service.uebersicht(aktor);
  }

  /** Herkunfts-Metadaten (Dateiname + Datenstand) je Datenart für den Quelldatei-Hinweis. Nur Metadaten -> alle Rollen. */
  @Roles(...ALLE_ROLLEN)
  @Get('quellen')
  quellen() {
    return this.service.datenQuellen();
  }

  @Roles(...ALLE_ROLLEN)
  @Get('ist-daten')
  istDaten(
    @Query('jahr') jahr: string,
    @Query('regionCode') regionCode: string | undefined,
    @Query('landId') landId: string | undefined,
    @Query('e1Id') e1Id: string | undefined,
    @Query('monat') monat: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @CurrentUser() aktor: RequestUser,
  ) {
    return this.service.istDaten(this.j(jahr), aktor, { regionCode, landId, e1Id, monat: monat ? Number(monat) : undefined }, Number(page) || 1, Number(pageSize) || 50);
  }

  @Roles(...ALLE_ROLLEN)
  @Get('budget-daten')
  budgetDaten(
    @Query('jahr') jahr: string,
    @Query('regionCode') regionCode: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @CurrentUser() aktor: RequestUser,
  ) {
    return this.service.budgetDaten(this.j(jahr), aktor, { regionCode }, Number(page) || 1, Number(pageSize) || 50);
  }

  @Roles(...ALLE_ROLLEN)
  @Get('drilldown')
  drilldown(
    @Query('jahr') jahr: string,
    @Query('regionCode') regionCode: string | undefined,
    @Query('landId') landId: string | undefined,
    @Query('e1Id') e1Id: string | undefined,
    @CurrentUser() aktor: RequestUser,
  ) {
    return this.service.drilldown(Number(jahr) || new Date().getUTCFullYear(), aktor, { regionCode, landId, e1Id });
  }

  @Roles(...ALLE_ROLLEN)
  @Get('einzelbuchungen')
  einzelbuchungen(
    @Query('jahr') jahr: string,
    @Query('landId') landId: string | undefined,
    @Query('e1Id') e1Id: string | undefined,
    @Query('e2Id') e2Id: string | undefined,
    @CurrentUser() aktor: RequestUser,
  ) {
    return this.service.einzelbuchungen(Number(jahr) || new Date().getUTCFullYear(), aktor, { landId, e1Id, e2Id });
  }

  @Roles('BU_LEITER')
  @Patch('sondereffekt/:recid')
  sondereffekt(@Param('recid') recid: string, @Body() dto: SondereffektDto, @CurrentUser() aktor: RequestUser) {
    return this.service.markSondereffekt(recid, dto.istSondereffekt, dto.grund ?? null, aktor);
  }
}
