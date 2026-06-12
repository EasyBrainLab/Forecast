import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { PeriodeService } from './periode.service';

class AbschlussDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notiz?: string;
}

@ApiTags('periode')
@ApiBearerAuth()
@Controller('periode')
export class PeriodeController {
  constructor(private readonly service: PeriodeService) {}

  @Roles('VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT')
  @Get('uebersicht')
  uebersicht(@Query('jahr') jahr: string) {
    return this.service.uebersicht(Number(jahr) || new Date().getUTCFullYear());
  }

  @Roles('VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT')
  @Get('detail')
  detail(@Query('jahr') jahr: string, @Query('monat') monat: string) {
    return this.service.detail(Number(jahr) || new Date().getUTCFullYear(), Number(monat) || 12);
  }

  @Roles('BU_LEITER', 'ADMIN')
  @Post(':jahr/:monat/abschliessen')
  abschliessen(@Param('jahr') jahr: string, @Param('monat') monat: string, @Body() dto: AbschlussDto, @CurrentUser() aktor: RequestUser) {
    return this.service.abschliessen(Number(jahr), Number(monat), dto.notiz ?? null, aktor);
  }

  @Roles('BU_LEITER', 'ADMIN')
  @Post(':jahr/:monat/wieder-oeffnen')
  wiederOeffnen(@Param('jahr') jahr: string, @Param('monat') monat: string, @CurrentUser() aktor: RequestUser) {
    return this.service.wiederOeffnen(Number(jahr), Number(monat), aktor);
  }
}
