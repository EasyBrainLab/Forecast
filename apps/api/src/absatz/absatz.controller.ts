import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { IsArray, IsString, MaxLength } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { ScopeService } from '../scope/scope.service';
import { AbsatzService } from './absatz.service';
import { AbsatzImportService, parsePeriodeAusDateiname } from './absatz-import.service';
import { KundeRegionService } from './kunde-region.service';

interface UploadFile {
  buffer: Buffer;
  originalname: string;
}

class KundeRegionDto {
  @IsString()
  @MaxLength(300)
  kunde!: string;

  @IsString()
  @MaxLength(20)
  regionCode!: string;
}

class KundeRegionBulkDto {
  @IsArray()
  items!: { kunde: string; regionCode: string }[];
}

@ApiTags('absatz')
@ApiBearerAuth()
@Controller('absatz')
export class AbsatzController {
  constructor(
    private readonly service: AbsatzService,
    private readonly importService: AbsatzImportService,
    private readonly kundeRegion: KundeRegionService,
    private readonly scope: ScopeService,
  ) {}

  /** AGM -> nur eigene Regionen (regionCode-Filter); alle anderen Rollen -> unbeschränkt (null). */
  private async regionFilter(aktor: RequestUser): Promise<string[] | null> {
    if (aktor.rolle !== 'AGM') return null;
    const s = await this.scope.getScope(aktor);
    if (s.unbeschraenkt) return null; // AGM_CROSS_SICHT
    return s.regionCodes;
  }

  @Roles('AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT')
  @Get('perioden')
  async perioden(@CurrentUser() aktor: RequestUser) {
    return this.service.perioden(await this.regionFilter(aktor));
  }

  @Roles('AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT')
  @Get('kpi')
  async kpi(@Query('jahr') jahr: string, @Query('bisMonat') bisMonat: string, @CurrentUser() aktor: RequestUser) {
    return this.service.kpi(Number(jahr) || new Date().getUTCFullYear(), Number(bisMonat) || 12, await this.regionFilter(aktor));
  }

  @Roles('AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT')
  @Get('daten')
  async daten(@Query('jahr') jahr: string, @Query('bisMonat') bisMonat: string, @Query('landId') landId: string | undefined, @Query('page') page: string, @Query('pageSize') pageSize: string, @CurrentUser() aktor: RequestUser) {
    return this.service.daten(Number(jahr) || new Date().getUTCFullYear(), Number(bisMonat) || 12, Number(page) || 1, Number(pageSize) || 50, landId, await this.regionFilter(aktor));
  }

  @Roles('BU_LEITER', 'ADMIN')
  @Post('import')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  async import(@UploadedFile() file: UploadFile, @Query('jahr') jahr: string, @Query('bisMonat') bisMonat: string, @CurrentUser() aktor: RequestUser) {
    if (!file) throw new BadRequestException('Keine Datei übergeben.');
    const ausName = parsePeriodeAusDateiname(file.originalname);
    const periode = { jahr: Number(jahr) || ausName?.jahr || 0, bisMonat: Number(bisMonat) || ausName?.bisMonat || 0 };
    if (!periode.jahr || !periode.bisMonat) {
      throw new BadRequestException('Periode nicht erkannt — bitte jahr & bisMonat angeben (oder Dateiname SF_MM_MM_JJJJ).');
    }
    const maxJahr = new Date().getUTCFullYear() + 1;
    if (periode.bisMonat < 1 || periode.bisMonat > 12 || periode.jahr < 2020 || periode.jahr > maxJahr) {
      throw new BadRequestException(`Unplausible Periode (Jahr ${periode.jahr}, bis-Monat ${periode.bisMonat}). Erwartet: Monat 1–12, Jahr 2020–${maxJahr}.`);
    }
    return this.importService.importiere(file.buffer, file.originalname, periode, { id: aktor.id, email: aktor.email });
  }

  // ─────────────── Kunde → Region-Mapping (Admin) ───────────────
  @Roles('ADMIN', 'SUPPORT')
  @Get('kunde-region')
  kundeRegionList() {
    return this.kundeRegion.list();
  }

  @Roles('ADMIN', 'SUPPORT')
  @Get('kunde-region/unmapped')
  kundeRegionUnmapped() {
    return this.kundeRegion.unmapped();
  }

  @Roles('ADMIN')
  @Put('kunde-region')
  kundeRegionUpsert(@Body() dto: KundeRegionDto, @CurrentUser() aktor: RequestUser) {
    return this.kundeRegion.upsert(dto.kunde, dto.regionCode, aktor);
  }

  @Roles('ADMIN')
  @Post('kunde-region/bulk')
  kundeRegionBulk(@Body() dto: KundeRegionBulkDto, @CurrentUser() aktor: RequestUser) {
    return this.kundeRegion.bulkUpsert(dto.items ?? [], aktor);
  }

  @Roles('ADMIN')
  @Delete('kunde-region/:kunde')
  kundeRegionRemove(@Param('kunde') kunde: string, @CurrentUser() aktor: RequestUser) {
    return this.kundeRegion.remove(decodeURIComponent(kunde), aktor);
  }
}
