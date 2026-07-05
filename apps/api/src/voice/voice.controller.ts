import { BadRequestException, Controller, Delete, Get, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { ALLE_ROLLEN, Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { VoiceService } from './voice.service';

interface UploadFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

const MAX_BYTES = 25 * 1024 * 1024;
const ERLAUBTE_MIME = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-m4a', 'audio/aac', 'text/plain'];

@ApiTags('voice')
@ApiBearerAuth()
@Controller('voice')
export class VoiceController {
  constructor(private readonly service: VoiceService) {}

  /** Feature-Detection: ist Diktat auf diesem System konfiguriert? */
  @Roles(...ALLE_ROLLEN)
  @Get('status')
  status() {
    return this.service.status();
  }

  @Roles('AGM', 'ADMIN')
  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: MAX_BYTES } }))
  upload(
    @UploadedFile() file: UploadFile,
    @Query('periode') periode: string,
    @Query('regionCode') regionCode: string,
    @Query('sprache') sprache: string | undefined,
    @CurrentUser() aktor: RequestUser,
  ) {
    if (!file) throw new BadRequestException('Keine Audiodatei übergeben.');
    const mime = (file.mimetype ?? '').split(';')[0].trim().toLowerCase();
    // text/plain ist ausschließlich für den Mock-STT-Testpfad zugelassen.
    if (!ERLAUBTE_MIME.includes(mime) && !mime.startsWith('audio/')) {
      throw new BadRequestException(`Nicht unterstütztes Audioformat: ${mime}`);
    }
    if (!periode || !regionCode) throw new BadRequestException('periode und regionCode sind erforderlich.');
    return this.service.upload(file.buffer, mime, periode, regionCode, sprache, aktor);
  }

  @Roles('AGM', 'ADMIN')
  @Post(':id/extrahieren')
  extrahieren(@Param('id') id: string, @CurrentUser() aktor: RequestUser) {
    return this.service.extrahieren(id, aktor);
  }

  @Roles('AGM', 'ADMIN')
  @Post(':id/bestaetigen')
  bestaetigen(@Param('id') id: string, @CurrentUser() aktor: RequestUser) {
    return this.service.bestaetigen(id, aktor);
  }

  @Roles('AGM', 'ADMIN')
  @Delete(':id')
  verwerfen(@Param('id') id: string, @CurrentUser() aktor: RequestUser) {
    return this.service.verwerfen(id, aktor);
  }
}
