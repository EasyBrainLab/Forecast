import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { ALLE_ROLLEN, Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { TenderAnalyseService, type UebernahmeInput } from './tender-analyse.service';
import { TenderAnalyseProvider } from './tender-analyse.provider';

interface UploadFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

class UebernahmeDto implements UebernahmeInput {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  referenznummer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  krankenhaus?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  stadt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  landIso?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  regionCode?: string;

  @IsOptional()
  @IsString()
  veroeffentlichtAm?: string;

  @IsOptional()
  @IsString()
  abgabefrist?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notiz?: string;

  @IsOptional()
  @IsArray()
  lose?: { bezeichnung: string; menge?: number | null; volumenEur?: number | null }[];
}

class AntwortDto {
  @IsOptional()
  @IsArray()
  fragen?: { frage: string; antwortVorschlag: string; quelle: string }[];
}

@ApiTags('tender-analyse')
@ApiBearerAuth()
@Controller('tender-analyse')
export class TenderAnalyseController {
  constructor(
    private readonly service: TenderAnalyseService,
    private readonly provider: TenderAnalyseProvider,
  ) {}

  /** Feature-Detection: ist die KI-Analyse konfiguriert? */
  @Roles(...ALLE_ROLLEN)
  @Get('status')
  async status() {
    const p = await this.provider.provider();
    return { verfuegbar: p !== 'aus', provider: p };
  }

  @Roles(...ALLE_ROLLEN)
  @Get()
  liste(@CurrentUser() aktor: RequestUser) {
    return this.service.liste(aktor);
  }

  @Roles('AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN')
  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('dokument', { limits: { fileSize: 15 * 1024 * 1024 } }))
  upload(@UploadedFile() file: UploadFile, @Query('regionCode') regionCode: string | undefined, @CurrentUser() aktor: RequestUser) {
    if (!file) throw new BadRequestException('Keine Datei übergeben.');
    return this.service.upload(file.buffer, file.originalname, file.mimetype ?? 'application/octet-stream', regionCode, aktor);
  }

  @Roles('AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN')
  @Post(':id/analysieren')
  analysieren(@Param('id') id: string, @CurrentUser() aktor: RequestUser) {
    return this.service.analysieren(id, aktor);
  }

  @Roles('AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN')
  @Post(':id/tender')
  tenderAnlegen(@Param('id') id: string, @Body() dto: UebernahmeDto, @CurrentUser() aktor: RequestUser) {
    return this.service.tenderAnlegen(id, dto, aktor);
  }

  @Roles('AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN')
  @Post(':id/antwort-docx')
  async antwortDocx(@Param('id') id: string, @Body() dto: AntwortDto, @CurrentUser() aktor: RequestUser, @Res() res: Response) {
    const { dateiname, buffer } = await this.service.antwortDocx(id, dto.fragen, aktor);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${dateiname}"`,
    });
    res.send(buffer);
  }

  @Roles('AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN')
  @Delete(':id')
  verwerfen(@Param('id') id: string, @CurrentUser() aktor: RequestUser) {
    return this.service.verwerfen(id, aktor);
  }
}
