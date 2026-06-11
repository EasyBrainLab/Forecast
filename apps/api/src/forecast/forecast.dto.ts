import { Type } from 'class-transformer';
import { IsArray, IsObject, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class ZelleDto {
  @IsString()
  landId!: string;

  @IsString()
  e1Id!: string;

  // { "2026-06": { "eur": 12000, "units": 4 }, ... }
  @IsObject()
  monatswerteRest!: Record<string, { eur: number; units?: number | null }>;
}

export class AnpassenDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  kommentar?: string;

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
