import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ALLE_ROLLEN, Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { BudgetAenderungService } from './budget-aenderung.service';
import { CreateBudgetAenderungDto, EntscheidungDto } from './budget-aenderung.dto';

@ApiTags('budget-aenderungen')
@ApiBearerAuth()
@Controller('budget-aenderungen')
export class BudgetAenderungController {
  constructor(private readonly service: BudgetAenderungService) {}

  @Roles(...ALLE_ROLLEN)
  @Get()
  list(@CurrentUser() aktor: RequestUser) {
    return this.service.list(aktor);
  }

  @Roles('AGM', 'BU_LEITER')
  @Post()
  create(@Body() dto: CreateBudgetAenderungDto, @CurrentUser() aktor: RequestUser) {
    return this.service.create(dto, aktor);
  }

  @Roles('AGM', 'BU_LEITER')
  @Post(':id/beantragen')
  beantragen(@Param('id') id: string, @CurrentUser() aktor: RequestUser) {
    return this.service.beantragen(id, aktor);
  }

  @Roles('VERTRIEBSLEITER')
  @Post(':id/freigabe-vl')
  freigabeVl(@Param('id') id: string, @CurrentUser() aktor: RequestUser) {
    return this.service.freigabeVl(id, aktor);
  }

  @Roles('BU_LEITER')
  @Post(':id/freigabe-bu')
  freigabeBu(@Param('id') id: string, @CurrentUser() aktor: RequestUser) {
    return this.service.freigabeBu(id, aktor);
  }

  @Roles('VERTRIEBSLEITER', 'BU_LEITER')
  @Post(':id/ablehnen')
  ablehnen(@Param('id') id: string, @Body() dto: EntscheidungDto, @CurrentUser() aktor: RequestUser) {
    return this.service.ablehnen(id, aktor, dto);
  }
}
