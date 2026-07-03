/**
 * Fuzzy-Matching für Standort-/Klinik-Namen (framework-frei, isomorph, 100 % getestet).
 * Dient dem Zuordnen von ERP-Lieferadressnamen (`Absatz.kunde`) zu `CustomerSite`-Stammdaten —
 * liefert nur Vorschläge zur manuellen Bestätigung, ordnet nie automatisch zu.
 */

/** Normalisiert einen Namen: Diakritika entfernen, lowercase, Sonderzeichen -> Space, Whitespace kollabieren. */
export function normalizeSiteName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Token-(Wort-)Menge des normalisierten Namens. */
export function tokenSet(name: string): Set<string> {
  const n = normalizeSiteName(name);
  return new Set(n ? n.split(' ') : []);
}

/** Jaccard-Ähnlichkeit zweier Mengen (0..1). Zwei leere Mengen -> 0. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let schnitt = 0;
  for (const x of a) if (b.has(x)) schnitt++;
  return schnitt / (a.size + b.size - schnitt);
}

/** Ähnlichkeit zweier Namen (0..1): leere Eingabe -> 0, exakt nach Normalisierung -> 1, sonst Token-Jaccard. */
export function nameAehnlichkeit(a: string, b: string): number {
  const na = normalizeSiteName(a);
  const nb = normalizeSiteName(b);
  if (na === '' || nb === '') return 0;
  if (na === nb) return 1;
  return jaccard(tokenSet(a), tokenSet(b));
}

export interface SiteKandidat {
  id: string;
  name: string;
}
export interface SiteMatch {
  id: string;
  name: string;
  score: number;
}

/** Beste Kandidaten für `name` (Score >= `schwelle`), absteigend sortiert, höchstens `limit`. */
export function findeSiteKandidaten(name: string, kandidaten: readonly SiteKandidat[], schwelle = 0.5, limit = 5): SiteMatch[] {
  return kandidaten
    .map((k) => ({ id: k.id, name: k.name, score: nameAehnlichkeit(name, k.name) }))
    .filter((m) => m.score >= schwelle)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
