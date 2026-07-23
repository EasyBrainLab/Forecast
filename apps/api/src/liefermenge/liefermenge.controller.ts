import { BadRequestException, Controller, Get, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { ScopeService } from '../scope/scope.service';
import { LiefermengeService } from './liefermenge.service';
import { LiefermengeImportService } from './liefermenge-import.service';
import { CsvLiefermengeAdapter } from './csv-liefermenge.adapter';

interface UploadFile {
  buffer: Buffer;
  originalname: string;
}

@ApiTags('liefermenge')
@ApiBearerAuth()
@Controller('liefermenge')
export class LiefermengeController {
  constructor(
    private readonly service: LiefermengeService,
    private readonly importService: LiefermengeImportService,
    private readonly scope: ScopeService,
  ) {}

  /** AGM -> nur eigene Regionen; alle anderen Rollen -> unbeschränkt (null). */
  private async regionFilter(aktor: RequestUser): Promise<string[] | null> {
    if (aktor.rolle !== 'AGM') return null;
    const s = await this.scope.getScope(aktor);
    if (s.unbeschraenkt) return null;
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
  async daten(
    @Query('jahr') jahr: string,
    @Query('regionCode') regionCode: string | undefined,
    @Query('e1Id') e1Id: string | undefined,
    @Query('monat') monat: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @CurrentUser() aktor: RequestUser,
  ) {
    return this.service.daten(
      Number(jahr) || new Date().getUTCFullYear(),
      { regionCode, e1Id, monat: monat ? Number(monat) : undefined },
      Number(page) || 1,
      Number(pageSize) || 50,
      await this.regionFilter(aktor),
    );
  }

  @Roles('BU_LEITER', 'ADMIN')
  @Post('import')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  async import(@UploadedFile() file: UploadFile, @CurrentUser() aktor: RequestUser) {
    if (!file) throw new BadRequestException('Keine Datei übergeben.');
    const adapter = new CsvLiefermengeAdapter(file.buffer, file.originalname);
    return this.importService.importiere(adapter, { id: aktor.id, email: aktor.email });
  }
}
