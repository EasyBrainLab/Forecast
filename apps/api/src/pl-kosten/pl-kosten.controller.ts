import { BadRequestException, Body, Controller, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { IsNumber, Max, Min } from 'class-validator';
import { ebitZielmargeKey } from '@forecast/shared';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PlKostenImportService } from './pl-kosten-import.service';

interface UploadFile {
  buffer: Buffer;
  originalname: string;
}

class ZielmargeDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  prozent!: number;
}

@ApiTags('pl-kosten')
@ApiBearerAuth()
@Controller('pl-kosten')
export class PlKostenController {
  constructor(
    private readonly importService: PlKostenImportService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Roles('BU_LEITER', 'ADMIN')
  @Post('import')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  async import(@UploadedFile() file: UploadFile, @Query('jahr') jahr: string, @CurrentUser() aktor: RequestUser) {
    if (!file) throw new BadRequestException('Keine Datei übergeben.');
    return this.importService.importiere(file.buffer, file.originalname, Number(jahr) || null, { id: aktor.id, email: aktor.email });
  }

  /** Ziel-Bruttomarge (%) je Jahr für die Forecast-COGS-Rechnung setzen. */
  @Roles('BU_LEITER', 'ADMIN')
  @Patch('zielmarge')
  async setZielmarge(@Query('jahr') jahr: string, @Body() dto: ZielmargeDto, @CurrentUser() aktor: RequestUser) {
    const j = Number(jahr) || new Date().getUTCFullYear();
    const key = ebitZielmargeKey(j);
    await this.prisma.einstellung.upsert({
      where: { key },
      update: { value: String(dto.prozent), aktualisiertVonId: aktor.id },
      create: { key, value: String(dto.prozent), beschreibung: `EBIT-Ziel-Bruttomarge ${j} (%)`, aktualisiertVonId: aktor.id },
    });
    await this.audit.write({ entitaet: 'Einstellung', entitaetId: key, aktion: 'UPDATE', userId: aktor.id, userEmail: aktor.email, nachherWert: { jahr: j, prozent: dto.prozent } });
    return { jahr: j, prozent: dto.prozent };
  }
}
