import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { SalesKiService } from './sales-ki.service';

class FrageDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  frage!: string;
}

@ApiTags('sales-ki')
@ApiBearerAuth()
@Controller('sales-ki')
export class SalesKiController {
  constructor(private readonly service: SalesKiService) {}

  @Roles('VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN')
  @Post('frage')
  frage(@Body() dto: FrageDto) {
    return this.service.beantworte(dto.frage);
  }
}
