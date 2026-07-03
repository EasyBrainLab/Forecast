import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { ALLE_ROLLEN, Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

class CompetitorCreateDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notiz?: string;

  @IsOptional()
  @IsInt()
  sortierung?: number;
}

class CompetitorPatchDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsBoolean()
  aktiv?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notiz?: string;

  @IsOptional()
  @IsInt()
  sortierung?: number;
}

@ApiTags('competitor')
@ApiBearerAuth()
@Controller('competitor')
export class CompetitorController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Stammliste lesen (alle Rollen); ?nurAktiv=true blendet deaktivierte aus (für Auswahllisten). */
  @Roles(...ALLE_ROLLEN)
  @Get()
  liste(@Query('nurAktiv') nurAktiv?: string) {
    const where = nurAktiv === 'true' ? { aktiv: true } : {};
    return this.prisma.competitor.findMany({ where, orderBy: [{ sortierung: 'asc' }, { name: 'asc' }] });
  }

  @Roles('ADMIN')
  @Post()
  async erstellen(@Body() dto: CompetitorCreateDto, @CurrentUser() aktor: RequestUser) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Name ist erforderlich.');
    const c = await this.prisma.competitor.create({ data: { name: name.slice(0, 120), notiz: dto.notiz?.trim() || null, sortierung: dto.sortierung ?? 0 } });
    await this.audit.write({ entitaet: 'Competitor', entitaetId: c.id, aktion: 'CREATE', userId: aktor.id, userEmail: aktor.email, nachherWert: { name } });
    return c;
  }

  @Roles('ADMIN')
  @Patch(':id')
  async patch(@Param('id') id: string, @Body() dto: CompetitorPatchDto, @CurrentUser() aktor: RequestUser) {
    // Whitelist-PATCH: nur explizit übergebene Felder.
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      const n = dto.name.trim();
      if (!n) throw new BadRequestException('Name darf nicht leer sein.');
      data.name = n.slice(0, 120);
    }
    if (dto.aktiv !== undefined) data.aktiv = dto.aktiv;
    if (dto.notiz !== undefined) data.notiz = dto.notiz?.trim() || null;
    if (dto.sortierung !== undefined) data.sortierung = dto.sortierung;
    const c = await this.prisma.competitor.update({ where: { id }, data });
    await this.audit.write({ entitaet: 'Competitor', entitaetId: id, aktion: 'UPDATE', userId: aktor.id, userEmail: aktor.email, nachherWert: data });
    return c;
  }

  @Roles('ADMIN')
  @Delete(':id')
  async loeschen(@Param('id') id: string, @CurrentUser() aktor: RequestUser) {
    const c = await this.prisma.competitor.delete({ where: { id } });
    await this.audit.write({ entitaet: 'Competitor', entitaetId: id, aktion: 'DELETE', userId: aktor.id, userEmail: aktor.email, vorherWert: { name: c.name } });
    return { geloescht: true };
  }
}
