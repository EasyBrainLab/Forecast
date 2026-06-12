import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { IsArray, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { ALLE_ROLLEN, Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { SalesFlashService } from './sales-flash.service';

interface UploadFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

class ActualsDto {
  @IsOptional()
  @IsNumber()
  total?: number | null;

  @IsOptional()
  @IsArray()
  regionen?: { regionCode: string; eur: number }[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  kommentar?: string;
}

@ApiTags('sales-flash')
@ApiBearerAuth()
@Controller('sales-flash')
export class SalesFlashController {
  constructor(private readonly service: SalesFlashService) {}

  @Roles('VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT')
  @Get()
  list() {
    return this.service.list();
  }

  @Roles('VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT')
  @Get('reconciliation')
  reconciliation(@Query('jahr') jahr: string, @Query('monat') monat: string) {
    return this.service.reconciliation(Number(jahr) || new Date().getUTCFullYear(), Number(monat) || 12);
  }

  @Roles(...ALLE_ROLLEN)
  @Get(':id/download')
  async download(@Param('id') id: string, @Res() res: Response) {
    const { dateiname, mimeType, inhalt } = await this.service.download(id);
    res.setHeader('Content-Type', mimeType || 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(dateiname)}"`);
    res.send(inhalt);
  }

  @Roles('BU_LEITER', 'ADMIN')
  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  async upload(@UploadedFile() file: UploadFile, @Query('jahr') jahr: string, @Query('monat') monat: string, @CurrentUser() aktor: RequestUser) {
    if (!file) throw new BadRequestException('Keine Datei übergeben.');
    return this.service.upload(file.buffer, file.originalname, file.mimetype || 'application/pdf', Number(jahr), Number(monat), aktor);
  }

  @Roles('BU_LEITER', 'ADMIN')
  @Put('actuals')
  setActuals(@Query('jahr') jahr: string, @Query('monat') monat: string, @Body() dto: ActualsDto, @CurrentUser() aktor: RequestUser) {
    return this.service.setActuals(Number(jahr), Number(monat), { total: dto.total ?? null, regionen: dto.regionen ?? [] }, dto.kommentar ?? null, aktor);
  }
}
