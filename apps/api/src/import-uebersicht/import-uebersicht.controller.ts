import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { ImportUebersichtService } from './import-uebersicht.service';

@ApiTags('import-uebersicht')
@ApiBearerAuth()
@Controller('import-uebersicht')
export class ImportUebersichtController {
  constructor(private readonly service: ImportUebersichtService) {}

  @Roles('BU_LEITER', 'ADMIN', 'SUPPORT')
  @Get()
  letzteImporte() {
    return this.service.letzteImporte();
  }
}
