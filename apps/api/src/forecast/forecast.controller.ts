import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ALLE_ROLLEN, Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { ForecastService } from './forecast.service';
import { AnpassenDto, BestaetigenDto, OeffnePeriodeDto, UeberschreibenDto, WiederOeffnenDto, ZurueckweisenDto } from './forecast.dto';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('forecast')
@ApiBearerAuth()
@Controller('forecast')
export class ForecastController {
  constructor(
    private readonly service: ForecastService,
    private readonly prisma: PrismaService,
  ) {}

  @Roles('VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT')
  @Get('status-board')
  statusBoard() {
    return this.service.statusBoard();
  }

  @Roles(...ALLE_ROLLEN)
  @Get('meine')
  meine(@CurrentUser() aktor: RequestUser) {
    return this.service.meinePerioden(aktor);
  }

  @Roles(...ALLE_ROLLEN)
  @Get(':periode/:regionCode/matrix')
  matrix(@Param('periode') periode: string, @Param('regionCode') regionCode: string, @CurrentUser() aktor: RequestUser) {
    return this.service.matrix(periode, regionCode, aktor);
  }

  @Roles('ADMIN', 'BU_LEITER')
  @Post('oeffnen')
  async oeffnen(@Body() dto: OeffnePeriodeDto, @CurrentUser() aktor: RequestUser) {
    const regionen = dto.regionCode
      ? [dto.regionCode]
      : (await this.prisma.region.findMany({ where: { forecastRelevant: true }, select: { code: true } })).map((r) => r.code);
    for (const regionCode of regionen) await this.service.oeffnePeriode(dto.periode, regionCode, aktor);
    return { geoeffnet: regionen };
  }

  @Roles('AGM')
  @Post(':periode/:regionCode/bestaetigen')
  bestaetigen(@Param('periode') periode: string, @Param('regionCode') regionCode: string, @Body() dto: BestaetigenDto, @CurrentUser() aktor: RequestUser) {
    return this.service.bestaetigen(periode, regionCode, aktor, dto.stellungnahme);
  }

  /** Offenen Forecast als Entwurf bearbeiten — AGM sowie Vertriebs-/BU-Leitung (mitbearbeiten). */
  @Roles('AGM', 'VERTRIEBSLEITER', 'BU_LEITER')
  @Post(':periode/:regionCode/anpassen')
  anpassen(@Param('periode') periode: string, @Param('regionCode') regionCode: string, @Body() dto: AnpassenDto, @CurrentUser() aktor: RequestUser) {
    return this.service.anpassen(periode, regionCode, aktor, dto);
  }

  /** Fertiggemeldeten Forecast (BESTAETIGT/ANGEPASST) auf OFFEN zurücksetzen — Leitung + Admin, Begründung Pflicht. */
  @Roles('VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN')
  @Post(':periode/:regionCode/zurueckweisen')
  zurueckweisen(@Param('periode') periode: string, @Param('regionCode') regionCode: string, @Body() dto: ZurueckweisenDto, @CurrentUser() aktor: RequestUser) {
    return this.service.zurueckweisen(periode, regionCode, aktor, dto.begruendung);
  }

  /** Fremdüberschreibung eines fertiggemeldeten Forecasts durch die Leitung (F10/F11); AGM wird informiert. */
  @Roles('VERTRIEBSLEITER', 'BU_LEITER')
  @Post(':periode/:regionCode/ueberschreiben')
  ueberschreiben(@Param('periode') periode: string, @Param('regionCode') regionCode: string, @Body() dto: UeberschreibenDto, @CurrentUser() aktor: RequestUser) {
    return this.service.ueberschreiben(periode, regionCode, aktor, dto);
  }

  /** AGM nimmt eine Fremdüberschreibung zur Kenntnis. */
  @Roles('AGM')
  @Post(':periode/:regionCode/quittieren')
  quittieren(@Param('periode') periode: string, @Param('regionCode') regionCode: string, @CurrentUser() aktor: RequestUser) {
    return this.service.quittieren(periode, regionCode, aktor);
  }

  /** F6/F7/F8 — schließt die Periode und kaskadierend alle älteren offenen Perioden der Region. */
  @Roles('BU_LEITER', 'ADMIN')
  @Post(':periode/:regionCode/abschliessen')
  abschliessen(@Param('periode') periode: string, @Param('regionCode') regionCode: string, @CurrentUser() aktor: RequestUser) {
    return this.service.abschliessen(periode, regionCode, aktor);
  }

  /** F9 — öffnet die Periode und kaskadierend alle jüngeren abgeschlossenen Perioden der Region. */
  @Roles('VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN')
  @Post(':periode/:regionCode/wieder-oeffnen')
  wiederOeffnen(@Param('periode') periode: string, @Param('regionCode') regionCode: string, @Body() dto: WiederOeffnenDto, @CurrentUser() aktor: RequestUser) {
    return this.service.wiederOeffnen(periode, regionCode, aktor, dto.begruendung);
  }
}
