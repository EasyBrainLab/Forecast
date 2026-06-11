import { BadRequestException, Controller, Get, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { ALLE_ROLLEN, Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../scope/scope.service';
import { BudgetImportService } from './budget-import.service';

interface UploadFile {
  buffer: Buffer;
  originalname: string;
}

@ApiTags('budget')
@ApiBearerAuth()
@Controller('budgets')
export class BudgetController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly importService: BudgetImportService,
  ) {}

  @Roles(...ALLE_ROLLEN)
  @Get()
  async list(@CurrentUser() aktor: RequestUser, @Query('jahr') jahr?: string) {
    const scope = await this.scope.getScope(aktor);
    const where: Prisma.BudgetWhereInput = { status: 'AKTIV', ...(scope.unbeschraenkt ? {} : this.scope.regionWhere(scope)) };
    if (jahr) where.jahr = Number(jahr);
    return this.prisma.budget.findMany({ where, take: 2000, orderBy: [{ jahr: 'asc' }, { monat: 'asc' }] });
  }

  @Roles('BU_LEITER', 'ADMIN')
  @Post('import')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  async import(@UploadedFile() file: UploadFile, @CurrentUser() aktor: RequestUser) {
    if (!file) throw new BadRequestException('Keine Datei übergeben.');
    return this.importService.importiere(file.buffer, file.originalname, { id: aktor.id, email: aktor.email });
  }
}
