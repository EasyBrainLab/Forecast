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
