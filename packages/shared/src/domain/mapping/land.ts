import { LAND_NAME_TO_ISO_SPECIAL } from '../../constants';

export type CountryResult = { ok: true; iso: string } | { ok: false; grund: 'LAND_LEER' };

/**
 * Ist-CSV-Country: trim + uppercase + Leer-Erkennung. Gültigkeit gegen die DB-Land-Tabelle
 * prüft der Import-Service. 'pg' -> 'PG' (gültig, A2); '' -> Quarantäne LAND_LEER.
 */
export function normalizeCountryRaw(raw: string | null | undefined): CountryResult {
  const c = (raw ?? '').trim();
  if (c === '') return { ok: false, grund: 'LAND_LEER' };
  return { ok: true, iso: c.toUpperCase() };
}

export type LandNameResult =
  | { ok: true; iso: string; regionsreserve: false }
  | { ok: true; iso: null; regionsreserve: true }
  | { ok: false; grund: 'UNBEKANNTER_LANDNAME'; detail: string };

/**
 * Budget-Excel-Klartext (englisch) -> ISO. '(Leer)' -> Regionsreserve (kein Land).
 * Sonderfälle (Czech/Korea, South/...) zuerst, sonst case-insensitiver nameEn-Index.
 */
export function mapBudgetLandName(raw: string, nameEnLowerToIso: ReadonlyMap<string, string>): LandNameResult {
  const n = raw.trim();
  if (n === '(Leer)') return { ok: true, iso: null, regionsreserve: true };
  const special = LAND_NAME_TO_ISO_SPECIAL[n.toLowerCase()];
  if (special) return { ok: true, iso: special, regionsreserve: false };
  const iso = nameEnLowerToIso.get(n.toLowerCase());
  if (iso) return { ok: true, iso, regionsreserve: false };
  return { ok: false, grund: 'UNBEKANNTER_LANDNAME', detail: n };
}
