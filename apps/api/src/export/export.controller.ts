import { Controller, Get, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ALLE_ROLLEN, Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { ExportService } from './export.service';

@ApiTags('export')
@ApiBearerAuth()
@Controller('export')
export class ExportController {
  constructor(private readonly service: ExportService) {}

  private jahr(q?: string): number {
    return Number(q) || new Date().getUTCFullYear();
  }

  @Roles('VERTRIEBSLEITER', 'BU_LEITER')
  @Post('abweichungsbericht')
  async abweichungsbericht(@Query('jahr') jahr: string, @CurrentUser() aktor: RequestUser, @Res() res: Response): Promise<void> {
    const buf = await this.service.abweichungsbericht(this.jahr(jahr), aktor);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="abweichungsbericht-${this.jahr(jahr)}.xlsx"`,
    });
    res.send(buf);
  }

  @Roles('BU_LEITER')
  @Post('word-report')
  async wordReport(@Query('jahr') jahr: string, @CurrentUser() aktor: RequestUser, @Res() res: Response): Promise<void> {
    const buf = await this.service.wordReport(this.jahr(jahr), aktor);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="forecast-report-${this.jahr(jahr)}.docx"`,
    });
    res.send(buf);
  }

  @Roles(...ALLE_ROLLEN)
  @Get('rohdaten')
  async rohdaten(@Query('jahr') jahr: string, @CurrentUser() aktor: RequestUser, @Res() res: Response): Promise<void> {
    const buf = await this.service.rohdatenCsv(this.jahr(jahr), aktor);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="rohdaten-${this.jahr(jahr)}.csv"` });
    res.send(buf);
  }
}
