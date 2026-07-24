import { BadRequestException, Body, Controller, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { GuvImportService } from './guv-import.service';
import { GuvPlanService, type GuvPlanPatch } from './guv-plan.service';

interface UploadFile {
  buffer: Buffer;
  originalname: string;
}

@ApiTags('pl-kosten')
@ApiBearerAuth()
@Controller('pl-kosten')
export class PlKostenController {
  constructor(
    private readonly guvImportService: GuvImportService,
    private readonly guvPlanService: GuvPlanService,
  ) {}

  /** Detaillierte Controlling-GuV (YTD, IST/PY/BUD) importieren — Single Source of Truth für das GuV-Panel der Konsolidierung. */
  @Roles('BU_LEITER', 'ADMIN')
  @Post('guv-import')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  async guvImport(@UploadedFile() file: UploadFile, @Query('jahr') jahr: string, @Query('monat') monat: string, @CurrentUser() aktor: RequestUser) {
    if (!file) throw new BadRequestException('Keine Datei übergeben.');
    return this.guvImportService.importiere(file.buffer, file.originalname, Number(jahr) || null, Number(monat) || null, { id: aktor.id, email: aktor.email });
  }

  /** Monatsplanung der G&V (GM%, Other Costs, FTE) setzen — BU_LEITER/ADMIN, Whitelist. */
  @Roles('BU_LEITER', 'ADMIN')
  @Patch('guv-plan')
  async guvPlan(@Query('jahr') jahr: string, @Query('monat') monat: string, @Body() body: GuvPlanPatch, @CurrentUser() aktor: RequestUser) {
    return this.guvPlanService.patch(Number(jahr), Number(monat), body, { id: aktor.id, email: aktor.email });
  }
}
