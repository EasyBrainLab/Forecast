import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsOptional, IsString } from 'class-validator';
import { ALLE_ROLLEN, Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

class EinstellungDto {
  @IsString()
  value!: string;
}
class RegionsVerantwortungDto {
  @IsString()
  userId!: string;

  @IsString()
  regionCode!: string;

  @IsDateString()
  gueltigVon!: string;

  @IsOptional()
  @IsDateString()
  gueltigBis?: string;
}
class RegionPatchDto {
  @IsOptional()
  @IsString()
  bezeichnung?: string;

  @IsOptional()
  @IsBoolean()
  forecastRelevant?: boolean;
}

@ApiTags('stammdaten')
@ApiBearerAuth()
@Controller()
export class StammdatenController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Lesen (für UI-Auswahllisten) ──
  @Roles(...ALLE_ROLLEN)
  @Get('stammdaten/regionen')
  regionen() {
    return this.prisma.region.findMany({ orderBy: { code: 'asc' } });
  }

  @Roles(...ALLE_ROLLEN)
  @Get('stammdaten/kostenstellen')
  kostenstellen() {
    return this.prisma.kostenstelle.findMany({ orderBy: { nummer: 'asc' } });
  }

  @Roles(...ALLE_ROLLEN)
  @Get('stammdaten/laender')
  laender() {
    return this.prisma.land.findMany({ orderBy: { nameDe: 'asc' } });
  }

  @Roles(...ALLE_ROLLEN)
  @Get('stammdaten/produktgruppen')
  async produktgruppen() {
    const [e1, e2] = await Promise.all([
      this.prisma.produktgruppeE1.findMany({ orderBy: { sortierung: 'asc' } }),
      this.prisma.produktgruppeE2.findMany({ orderBy: { name: 'asc' } }),
    ]);
    return { e1, e2 };
  }

  @Roles(...ALLE_ROLLEN)
  @Get('stammdaten/regionsverantwortung')
  verantwortungen() {
    return this.prisma.regionsVerantwortung.findMany({ where: { geloeschtAm: null }, include: { user: { select: { email: true, name: true } } } });
  }

  @Roles(...ALLE_ROLLEN)
  @Get('einstellungen')
  einstellungen() {
    return this.prisma.einstellung.findMany({ orderBy: { key: 'asc' } });
  }

  // ── Admin-Mutationen ──
  @Roles('ADMIN')
  @Patch('admin/einstellungen/:key')
  async setEinstellung(@Param('key') key: string, @Body() dto: EinstellungDto, @CurrentUser() aktor: RequestUser) {
    const e = await this.prisma.einstellung.update({ where: { key }, data: { value: dto.value, aktualisiertVonId: aktor.id } });
    await this.audit.write({ entitaet: 'Einstellung', entitaetId: key, aktion: 'UPDATE', userId: aktor.id, userEmail: aktor.email, nachherWert: { value: dto.value } });
    return e;
  }

  @Roles('ADMIN')
  @Patch('admin/regionen/:code')
  async patchRegion(@Param('code') code: string, @Body() dto: RegionPatchDto, @CurrentUser() aktor: RequestUser) {
    const data: Record<string, unknown> = {};
    if (dto.bezeichnung !== undefined) data.bezeichnung = dto.bezeichnung;
    if (dto.forecastRelevant !== undefined) data.forecastRelevant = dto.forecastRelevant;
    const r = await this.prisma.region.update({ where: { code }, data });
    await this.audit.write({ entitaet: 'Region', entitaetId: code, aktion: 'UPDATE', userId: aktor.id, userEmail: aktor.email, nachherWert: data });
    return r;
  }

  // RegionsVerantwortung "umhängen" ohne Migration (Soft-Delete + Neuanlage)
  @Roles('ADMIN')
  @Post('admin/regionsverantwortung')
  async addVerantwortung(@Body() dto: RegionsVerantwortungDto, @CurrentUser() aktor: RequestUser) {
    const v = await this.prisma.regionsVerantwortung.create({
      data: { userId: dto.userId, regionCode: dto.regionCode, gueltigVon: new Date(dto.gueltigVon), gueltigBis: dto.gueltigBis ? new Date(dto.gueltigBis) : null },
    });
    await this.audit.write({ entitaet: 'RegionsVerantwortung', entitaetId: v.id, aktion: 'CREATE', userId: aktor.id, userEmail: aktor.email, nachherWert: { userId: dto.userId, regionCode: dto.regionCode } });
    return v;
  }

  @Roles('ADMIN')
  @Delete('admin/regionsverantwortung/:id')
  async endeVerantwortung(@Param('id') id: string, @CurrentUser() aktor: RequestUser) {
    const v = await this.prisma.regionsVerantwortung.update({ where: { id }, data: { geloeschtAm: new Date(), gueltigBis: new Date() } });
    await this.audit.write({ entitaet: 'RegionsVerantwortung', entitaetId: id, aktion: 'DELETE', userId: aktor.id, userEmail: aktor.email });
    return v;
  }

  @Roles('ADMIN', 'SUPPORT')
  @Get('audit')
  audit_(@CurrentUser() _aktor: RequestUser) {
    return this.prisma.auditTrail.findMany({ orderBy: { erstelltAm: 'desc' }, take: 200 });
  }
}
