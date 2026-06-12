import { BadRequestException, Controller, Get, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { AbsatzService } from './absatz.service';
import { AbsatzImportService, parsePeriodeAusDateiname } from './absatz-import.service';

interface UploadFile {
  buffer: Buffer;
  originalname: string;
}

@ApiTags('absatz')
@ApiBearerAuth()
@Controller('absatz')
export class AbsatzController {
  constructor(
    private readonly service: AbsatzService,
    private readonly importService: AbsatzImportService,
  ) {}

  @Roles('VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT')
  @Get('perioden')
  perioden() {
    return this.service.perioden();
  }

  @Roles('VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT')
  @Get('kpi')
  kpi(@Query('jahr') jahr: string, @Query('bisMonat') bisMonat: string) {
    return this.service.kpi(Number(jahr) || new Date().getUTCFullYear(), Number(bisMonat) || 12);
  }

  @Roles('VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT')
  @Get('daten')
  daten(@Query('jahr') jahr: string, @Query('bisMonat') bisMonat: string, @Query('landId') landId: string | undefined, @Query('page') page: string, @Query('pageSize') pageSize: string) {
    return this.service.daten(Number(jahr) || new Date().getUTCFullYear(), Number(bisMonat) || 12, Number(page) || 1, Number(pageSize) || 50, landId);
  }

  @Roles('BU_LEITER', 'ADMIN')
  @Post('import')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  async import(@UploadedFile() file: UploadFile, @Query('jahr') jahr: string, @Query('bisMonat') bisMonat: string, @CurrentUser() aktor: RequestUser) {
    if (!file) throw new BadRequestException('Keine Datei übergeben.');
    // Periode aus Query oder Dateiname
    const ausName = parsePeriodeAusDateiname(file.originalname);
    const periode = { jahr: Number(jahr) || ausName?.jahr || 0, bisMonat: Number(bisMonat) || ausName?.bisMonat || 0 };
    if (!periode.jahr || !periode.bisMonat) {
      throw new BadRequestException('Periode nicht erkannt — bitte jahr & bisMonat angeben (oder Dateiname SF_MM_MM_JJJJ).');
    }
    return this.importService.importiere(file.buffer, file.originalname, periode, { id: aktor.id, email: aktor.email });
  }
}
