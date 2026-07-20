import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  registerDecorator,
  ValidateNested,
  type ValidationOptions,
} from 'class-validator';

export const KOMMENTAR_MAX = 2000;

type MonatswertEintrag = { eur: number; units?: number | null; kommentar?: string | null };

/**
 * Validiert die Werte eines `monatswerteRest`-Records: eur Zahl, units optional Zahl/null,
 * kommentar optional String ≤ KOMMENTAR_MAX. class-validator rekursiert nicht in Record-Werte,
 * daher ein eigener Validator (sonst bliebe der Per-Monats-Kommentar unbegrenzt).
 */
function IsMonatswerteRest(options?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isMonatswerteRest',
      target: object.constructor,
      propertyName,
      options: { message: `${propertyName}: ungültiger Monatswert (eur Zahl, units Zahl/null, kommentar ≤ ${KOMMENTAR_MAX} Zeichen)`, ...options },
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'object' || value === null) return false;
          return Object.values(value as Record<string, unknown>).every((raw) => {
            if (typeof raw !== 'object' || raw === null) return false;
            const w = raw as MonatswertEintrag;
            if (typeof w.eur !== 'number' || !Number.isFinite(w.eur)) return false;
            if (w.units !== undefined && w.units !== null && (typeof w.units !== 'number' || !Number.isFinite(w.units))) return false;
            if (w.kommentar !== undefined && w.kommentar !== null && (typeof w.kommentar !== 'string' || w.kommentar.length > KOMMENTAR_MAX)) return false;
            return true;
          });
        },
      },
    });
  };
}

export class ZelleDto {
  @IsString()
  landId!: string;

  @IsString()
  e1Id!: string;

  // { "2026-06": { "eur": 12000, "units": 4, "kommentar": "Großauftrag Q3" }, ... }
  // kommentar ist Pflicht je Monat, der den Monats-Schwellwert gegen das Budget überschreitet.
  @IsObject()
  @IsMonatswerteRest()
  monatswerteRest!: Record<string, MonatswertEintrag>;
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

/** Finales Bestätigen: optionale kurze Stellungnahme des AGM (keine Pflicht). */
export class BestaetigenDto {
  @IsOptional()
  @IsString()
  @MaxLength(KOMMENTAR_MAX)
  stellungnahme?: string;
}

export class ZurueckweisenDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  begruendung!: string;
}

/** Fremdüberschreibung durch die Leitung: Zellen wie beim Anpassen, aber mit Pflicht-Begründung. */
export class UeberschreibenDto extends AnpassenDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  begruendung!: string;
}

export class WiederOeffnenDto {
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
