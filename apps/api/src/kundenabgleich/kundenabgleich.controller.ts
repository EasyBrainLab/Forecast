import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { KundenabgleichService } from './kundenabgleich.service';

const TYP_WERTE = ['OEFFENTLICH', 'PRIVAT', 'UNBEKANNT'];

class ZuordnenD365Dto {
  @IsString()
  @MaxLength(16)
  dataAreaId!: string;

  @IsString()
  @MaxLength(64)
  kundennummer!: string;

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
}

@ApiTags('kundenabgleich')
@ApiBearerAuth()
@Controller('kundenabgleich')
export class KundenabgleichController {
  constructor(private readonly service: KundenabgleichService) {}

  @Roles('BU_LEITER', 'ADMIN', 'SUPPORT')
  @Get('status')
  status() {
    return this.service.status();
  }

  @Roles('BU_LEITER', 'ADMIN', 'SUPPORT')
  @Get('vorschlaege')
  vorschlaege() {
    return this.service.vorschlaege();
  }

  @Roles('BU_LEITER', 'ADMIN', 'SUPPORT')
  @Get('rechnungskunden-ohne-stamm')
  rechnungskundenOhneStamm() {
    return this.service.rechnungskundenOhneStamm();
  }

  @Roles('BU_LEITER', 'ADMIN')
  @Post('zuordnen')
  zuordnen(@Body() dto: ZuordnenD365Dto, @CurrentUser() aktor: RequestUser) {
    return this.service.zuordnen(dto, aktor);
  }
}
