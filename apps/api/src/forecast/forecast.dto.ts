import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsObject, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class ZelleDto {
  @IsString()
  landId!: string;

  @IsString()
  e1Id!: string;

  // { "2026-06": { "eur": 12000, "units": 4, "kommentar": "Großauftrag Q3" }, ... }
  // kommentar ist Pflicht je Monat, der den Monats-Schwellwert gegen das Budget überschreitet.
  @IsObject()
  monatswerteRest!: Record<string, { eur: number; units?: number | null; kommentar?: string | null }>;
}

export class AnpassenDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  kommentar?: string;

  // true = Monatssicht: Pflichtkommentar je Einzelmonat, der den Monats-Schwellwert (5 %) überschreitet.
  @IsOptional()
  @IsBoolean()
  monatsModus?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ZelleDto)
  zellen!: ZelleDto[];
}

export class ZurueckweisenDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  begruendung!: string;
}

export class OeffnePeriodeDto {
  @Matches(/^\d{4}-\d{2}$/)
  periode!: string;

  @IsOptional()
  @IsString()
  regionCode?: string;
}
