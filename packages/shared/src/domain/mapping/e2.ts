import { E2_TABLE, type E2Definition } from '../../constants';
import { E1Kategorie } from '../../enums';

const BY_NAME_OR_SYNONYM = new Map<string, E2Definition>();
for (const def of E2_TABLE) {
  BY_NAME_OR_SYNONYM.set(def.name, def);
  for (const syn of def.synonyme) BY_NAME_OR_SYNONYM.set(syn, def);
}

export type E2Result =
  | { ok: true; name: string; e1: E1Kategorie; istPlatzhalter: boolean }
  | { ok: false; grund: 'UNBEKANNTE_E2'; detail: string };

/** Kanonischer Name der Platzhalter-E2 für leeres KTREB2 (A3). */
export function e2UnbekanntName(e1: E1Kategorie): string {
  return `Unbekannt (${e1})`;
}

/**
 * Mappt KTREB2/Budget-E2 (inkl. Synonyme mit/ohne "+") auf die kanonische E2.
 * - leeres KTREB2  -> Platzhalter "Unbekannt (E1)", istPlatzhalter=true (KEINE Quarantäne)
 * - generisches "Other" -> E1 folgt KTREB1 (e1Resolved)
 * - sonst E1 final aus E2-Stammtabelle
 */
export function mapE2(rawE2: string | null | undefined, e1Resolved: E1Kategorie): E2Result {
  const name = (rawE2 ?? '').trim();
  if (name === '') {
    return { ok: true, name: e2UnbekanntName(e1Resolved), e1: e1Resolved, istPlatzhalter: true };
  }
  const def = BY_NAME_OR_SYNONYM.get(name);
  if (!def) return { ok: false, grund: 'UNBEKANNTE_E2', detail: name };
  if (def.istGenerisch) {
    return { ok: true, name: def.name, e1: e1Resolved, istPlatzhalter: false };
  }
  return { ok: true, name: def.name, e1: def.e1, istPlatzhalter: false };
}
