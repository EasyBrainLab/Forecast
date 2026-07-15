import { BadRequestException, Controller, Get, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { SalesImportService } from './sales-import.service';

interface UploadFile {
  buffer: Buffer;
  originalname: string;
  size: number;
  mimetype: string;
}

const MAX_BYTES = 50 * 1024 * 1024;

function assertXlsx(file: UploadFile | undefined): void {
  if (!file) throw new BadRequestException('Keine Datei übergeben.');
  if (!file.originalname.toLowerCase().endsWith('.xlsx')) throw new BadRequestException('Nur Excel-Dateien (.xlsx) werden akzeptiert.');
}

@ApiTags('sales-import')
@ApiBearerAuth()
@Controller('sales-import')
export class SalesImportController {
  constructor(
    private readonly service: SalesImportService,
    private readonly prisma: PrismaService,
  ) {}

  @Roles('BU_LEITER', 'ADMIN')
  @Post('kundenstamm')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  kundenstamm(@UploadedFile() file: UploadFile, @CurrentUser() aktor: RequestUser) {
    assertXlsx(file);
    return this.service.importiereKundenstamm(file.buffer, file.originalname, { id: aktor.id, email: aktor.email });
  }

  @Roles('BU_LEITER', 'ADMIN')
  @Post('rechnungen')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  rechnungen(@UploadedFile() file: UploadFile, @CurrentUser() aktor: RequestUser) {
    assertXlsx(file);
    return this.service.importiereRechnungen(file.buffer, file.originalname, { id: aktor.id, email: aktor.email });
  }

  @Roles('BU_LEITER', 'ADMIN')
  @Post('positionen')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  positionen(@UploadedFile() file: UploadFile, @CurrentUser() aktor: RequestUser) {
    assertXlsx(file);
    return this.service.importierePositionen(file.buffer, file.originalname, { id: aktor.id, email: aktor.email });
  }

  @Roles('BU_LEITER', 'ADMIN', 'SUPPORT')
  @Get('batches')
  batches() {
    return this.prisma.importBatch.findMany({
      where: { typ: { in: ['KUNDENSTAMM', 'RECHNUNG', 'RECHNUNGSPOSITION'] } },
      orderBy: { erstelltAm: 'desc' },
      take: 50,
    });
  }
}
