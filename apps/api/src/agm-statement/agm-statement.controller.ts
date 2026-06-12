import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ALLE_ROLLEN, Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { AgmStatementService } from './agm-statement.service';

const GRUENDE = ['KEINE_ABWEICHUNG', 'MARKT', 'WETTBEWERB', 'PREIS', 'PROJEKTVERSCHIEBUNG', 'REGULATORISCH', 'LIEFERFAEHIGKEIT', 'EINMALEFFEKT', 'SONSTIGES'];

class StatementDto {
  @IsOptional()
  @IsIn(GRUENDE)
  abweichungGrund?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  abweichungKommentar?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  risiken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  chancen?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  pipeline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  kundenGewonnen?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  kundenVerloren?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  preisWettbewerb?: string;

  @IsOptional()
  @IsBoolean()
  forecastRealistisch?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  forecastKommentar?: string;

  @IsOptional()
  @IsArray()
  actionItems?: { beschreibung: string; faelligBis: string | null; erledigt: boolean }[];
}

@ApiTags('agm-statement')
@ApiBearerAuth()
@Controller('agm-statement')
export class AgmStatementController {
  constructor(private readonly service: AgmStatementService) {}

  @Roles(...ALLE_ROLLEN)
  @Get('periode/:periode')
  fuerPeriode(@Param('periode') periode: string, @CurrentUser() aktor: RequestUser) {
    return this.service.fuerPeriode(periode, aktor);
  }

  @Roles('VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT', 'AGM')
  @Get('action-items')
  actionItems(@CurrentUser() aktor: RequestUser) {
    return this.service.offeneActionItems(aktor);
  }

  @Roles('AGM')
  @Put('periode/:periode/region/:regionCode')
  speichern(@Param('periode') periode: string, @Param('regionCode') regionCode: string, @Body() dto: StatementDto, @CurrentUser() aktor: RequestUser) {
    return this.service.speichern(periode, regionCode, dto, aktor);
  }

  @Roles('AGM')
  @Post('periode/:periode/region/:regionCode/einreichen')
  einreichen(@Param('periode') periode: string, @Param('regionCode') regionCode: string, @CurrentUser() aktor: RequestUser) {
    return this.service.einreichen(periode, regionCode, aktor);
  }

  @Roles('AGM', 'ADMIN')
  @Post('periode/:periode/region/:regionCode/zuruecksetzen')
  zuruecksetzen(@Param('periode') periode: string, @Param('regionCode') regionCode: string, @CurrentUser() aktor: RequestUser) {
    return this.service.zuruecksetzen(periode, regionCode, aktor);
  }
}
