import { E1_LOOKUP, KST_TO_REGION, REGION_ZENTRAL } from '../../constants';
import { E1Kategorie } from '../../enums';

export type E1Result =
  | { ok: true; e1: E1Kategorie }
  | { ok: false; grund: 'UNBEKANNTE_E1'; detail: string };

/**
 * Mappt KTREB1/Budget-E1/Konsolidierungs-E1 auf das kanonische Enum.
 * Sammel-Kostenstellen haben Vorrang: -> ZENTRAL (kein Forecast).
 */
export function mapE1(rawE1: string, kstNummer: number): E1Result {
  if (KST_TO_REGION[kstNummer] === REGION_ZENTRAL) {
    return { ok: true, e1: E1Kategorie.ZENTRAL };
  }
  const key = rawE1.trim();
  const e1 = E1_LOOKUP[key];
  if (!e1) return { ok: false, grund: 'UNBEKANNTE_E1', detail: key };
  return { ok: true, e1 };
}
