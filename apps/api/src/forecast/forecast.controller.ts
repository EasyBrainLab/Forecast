import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ALLE_ROLLEN, Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { ForecastService } from './forecast.service';
import { AnpassenDto, OeffnePeriodeDto, ZurueckweisenDto } from './forecast.dto';
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
  bestaetigen(@Param('periode') periode: string, @Param('regionCode') regionCode: string, @CurrentUser() aktor: RequestUser) {
    return this.service.bestaetigen(periode, regionCode, aktor);
  }

  @Roles('AGM')
  @Post(':periode/:regionCode/anpassen')
  anpassen(@Param('periode') periode: string, @Param('regionCode') regionCode: string, @Body() dto: AnpassenDto, @CurrentUser() aktor: RequestUser) {
    return this.service.anpassen(periode, regionCode, aktor, dto);
  }

  @Roles('VERTRIEBSLEITER')
  @Post(':periode/:regionCode/zurueckweisen')
  zurueckweisen(@Param('periode') periode: string, @Param('regionCode') regionCode: string, @Body() dto: ZurueckweisenDto, @CurrentUser() aktor: RequestUser) {
    return this.service.zurueckweisen(periode, regionCode, aktor, dto.begruendung);
  }
}
