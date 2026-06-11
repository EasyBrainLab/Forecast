/**
 * Whitelist-PATCH (§7.4): erzeugt ein Objekt NUR aus den explizit erlaubten Feldern,
 * die im DTO definiert (nicht undefined) sind. Verhindert Body-Spreading auf Mutationen.
 */
export function pickDefined<T extends object, K extends keyof T>(quelle: T, erlaubteFelder: readonly K[]): Partial<Pick<T, K>> {
  const ergebnis: Partial<Pick<T, K>> = {};
  for (const feld of erlaubteFelder) {
    if (quelle[feld] !== undefined) {
      ergebnis[feld] = quelle[feld];
    }
  }
  return ergebnis;
}
