import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { IstImportService } from './ist-import.service';
import { CsvIstAdapter } from './csv-ist.adapter';

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
}
