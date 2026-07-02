import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { ALLE_ROLLEN, Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { TenderService } from './tender.service';

const STATUS_WERTE = ['BEOBACHTET', 'EINGEREICHT', 'GEWONNEN', 'VERLOREN', 'STORNIERT'];

/** Ein Los einer Ausschreibung. Elemente werden serverseitig zusätzlich sanitisiert (sanitizeLose). */
class LosDto {
  @IsString()
  @MaxLength(200)
  bezeichnung!: string;

  @IsOptional()
  @IsNumber()
  volumenEur?: number;

  @IsOptional()
  @IsNumber()
  menge?: number;
}

/** Ein DTO für Erstellen und Aktualisieren; Pflichtfelder erzwingt der Service (create). */
class UpsertTenderDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  referenznummer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  krankenhaus?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  stadt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  landIso?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  regionCode?: string;

  @IsOptional()
  @IsString()
  veroeffentlichtAm?: string;

  @IsOptional()
  @IsString()
  abgabefrist?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  wettbewerber?: string[];

  @IsOptional()
  @IsNumber()
  eigenerPreisEur?: number;

  @IsOptional()
  @IsNumber()
  wettbewerbPreisEur?: number;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notiz?: string;

  @IsOptional()
  @IsArray()
  lose?: LosDto[];
}

class StatusDto {
  @IsIn(STATUS_WERTE)
  status!: string;
}

@ApiTags('tender')
@ApiBearerAuth()
@Controller('tender')
export class TenderController {
  constructor(private readonly service: TenderService) {}

  @Roles(...ALLE_ROLLEN)
  @Get()
  liste(@CurrentUser() aktor: RequestUser, @Query('status') status?: string) {
    return this.service.liste(aktor, status);
  }

  @Roles(...ALLE_ROLLEN)
  @Get(':id')
  holen(@Param('id') id: string, @CurrentUser() aktor: RequestUser) {
    return this.service.holen(id, aktor);
  }

  @Roles('AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN')
  @Post()
  erstellen(@Body() dto: UpsertTenderDto, @CurrentUser() aktor: RequestUser) {
    return this.service.erstellen(dto, aktor);
  }

  @Roles('AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN')
  @Put(':id')
  aktualisieren(@Param('id') id: string, @Body() dto: UpsertTenderDto, @CurrentUser() aktor: RequestUser) {
    return this.service.aktualisieren(id, dto, aktor);
  }

  @Roles('AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN')
  @Post(':id/status')
  status(@Param('id') id: string, @Body() dto: StatusDto, @CurrentUser() aktor: RequestUser) {
    return this.service.statusSetzen(id, dto.status, aktor);
  }

  @Roles('BU_LEITER', 'ADMIN')
  @Delete(':id')
  loeschen(@Param('id') id: string, @CurrentUser() aktor: RequestUser) {
    return this.service.loeschen(id, aktor);
  }
}
