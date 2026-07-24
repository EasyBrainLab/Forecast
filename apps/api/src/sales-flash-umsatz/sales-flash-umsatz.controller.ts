import { BadRequestException, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { SalesFlashUmsatzImportService } from './sales-flash-umsatz-import.service';

interface UploadFile {
  buffer: Buffer;
  originalname: string;
}

@ApiTags('sales-flash-umsatz')
@ApiBearerAuth()
@Controller('sales-flash-umsatz')
export class SalesFlashUmsatzController {
  constructor(private readonly importService: SalesFlashUmsatzImportService) {}

  /** Transaktionsscharfen Controlling-Umsatz („Therapy Sales Flash") importieren — Voll-Ersatz je Jahr. */
  @Roles('BU_LEITER', 'ADMIN')
  @Post('import')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 40 * 1024 * 1024 } }))
  async import(@UploadedFile() file: UploadFile, @CurrentUser() aktor: RequestUser) {
    if (!file) throw new BadRequestException('Keine Datei übergeben.');
    return this.importService.importiere(file.buffer, file.originalname, { id: aktor.id, email: aktor.email });
  }
}
