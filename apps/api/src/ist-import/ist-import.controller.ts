import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { IstImportService } from './ist-import.service';
import { CsvIstAdapter } from './csv-ist.adapter';

class KlaerenDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  kommentar?: string;
}

interface UploadFile {
  buffer: Buffer;
  originalname: string;
  size: number;
  mimetype: string;
}

const MAX_BYTES = 50 * 1024 * 1024;

@ApiTags('ist-import')
@ApiBearerAuth()
@Controller('ist-import')
export class IstImportController {
  constructor(
    private readonly service: IstImportService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Roles('BU_LEITER', 'ADMIN')
  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async upload(@UploadedFile() file: UploadFile, @CurrentUser() aktor: RequestUser) {
    if (!file) throw new BadRequestException('Keine Datei übergeben.');
    if (!file.originalname.toLowerCase().endsWith('.csv')) {
      throw new BadRequestException('Nur CSV-Dateien werden akzeptiert.');
    }
    const adapter = new CsvIstAdapter(file.buffer, file.originalname);
    return this.service.importiere(adapter, { id: aktor.id, email: aktor.email });
  }

  @Roles('BU_LEITER', 'ADMIN', 'SUPPORT')
  @Get('batches')
  batches() {
    return this.prisma.importBatch.findMany({
      where: { typ: 'IST' },
      orderBy: { erstelltAm: 'desc' },
      take: 50,
    });
  }

  @Roles('BU_LEITER', 'ADMIN', 'SUPPORT')
  @Get('batches/:id/quarantaene')
  quarantaene(@Param('id') id: string) {
    return this.prisma.importQuarantaene.findMany({ where: { importBatchId: id }, orderBy: { zeilenNummer: 'asc' } });
  }

  /** Alle Quarantäne-Einträge über alle Batches (Default: nur OFFEN) — für die Klär-UI. */
  @Roles('BU_LEITER', 'ADMIN', 'SUPPORT')
  @Get('quarantaene')
  async quarantaeneListe(@Query('status') status?: string) {
    const erlaubt = ['OFFEN', 'GEKLAERT', 'VERWORFEN'];
    const st = erlaubt.includes(status ?? '') ? (status as 'OFFEN' | 'GEKLAERT' | 'VERWORFEN') : 'OFFEN';
    const rows = await this.prisma.importQuarantaene.findMany({
      where: { status: st },
      orderBy: [{ erstelltAm: 'desc' }, { zeilenNummer: 'asc' }],
      take: 500,
      include: { importBatch: { select: { dateiname: true, typ: true, erstelltAm: true } } },
    });
    const offen = await this.prisma.importQuarantaene.count({ where: { status: 'OFFEN' } });
    return { offenGesamt: offen, eintraege: rows };
  }

  /** Eintrag als geklärt markieren (z. B. Quelle korrigiert und neu importiert — RECID-Upsert heilt die Zeile). */
  @Roles('BU_LEITER', 'ADMIN')
  @Post('quarantaene/:id/klaeren')
  async klaeren(@Param('id') id: string, @Body() dto: KlaerenDto, @CurrentUser() aktor: RequestUser) {
    return this.setzeQuarantaeneStatus(id, 'GEKLAERT', dto.kommentar, aktor);
  }

  /** Eintrag verwerfen (Zeile gehört nicht in die Daten, keine Korrektur nötig). */
  @Roles('BU_LEITER', 'ADMIN')
  @Post('quarantaene/:id/verwerfen')
  async verwerfen(@Param('id') id: string, @Body() dto: KlaerenDto, @CurrentUser() aktor: RequestUser) {
    return this.setzeQuarantaeneStatus(id, 'VERWORFEN', dto.kommentar, aktor);
  }

  private async setzeQuarantaeneStatus(id: string, status: 'GEKLAERT' | 'VERWORFEN', kommentar: string | undefined, aktor: RequestUser) {
    const vorhanden = await this.prisma.importQuarantaene.findUnique({ where: { id } });
    if (!vorhanden) throw new NotFoundException('Quarantäne-Eintrag nicht gefunden.');
    if (vorhanden.status !== 'OFFEN') throw new BadRequestException('Eintrag ist bereits bearbeitet.');
    const result = await this.prisma.importQuarantaene.update({
      where: { id },
      data: { status, geklaertVonId: aktor.id, geklaertAm: new Date(), klaerKommentar: kommentar?.trim() || null },
    });
    await this.audit.write({
      entitaet: 'ImportQuarantaene',
      entitaetId: id,
      aktion: 'STATUS_WECHSEL',
      userId: aktor.id,
      userEmail: aktor.email,
      vorherWert: { status: 'OFFEN' },
      nachherWert: { status, kommentar: kommentar ?? null },
    });
    return result;
  }
}
