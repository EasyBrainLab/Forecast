/**
 * Parst deutsches Dezimalformat aus der Ist-CSV: optional in Anführungszeichen,
 * Tausenderpunkt, Dezimalkomma, optionales Vorzeichen. Beispiele:
 *   "-2493,00" -> -2493.0 ; "1.234,56" -> 1234.56 ; "" / "\"\"" -> null
 * Wirft PARSE_ERROR bei nicht-numerischem Inhalt.
 */
export class DecimalParseError extends Error {
  constructor(public readonly raw: string) {
    super(`Ungültiger Dezimalwert: ${JSON.stringify(raw)}`);
    this.name = 'DecimalParseError';
  }
}

export function parseDecimalDe(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  let s = input.trim();
  // umschließende Anführungszeichen entfernen
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    s = s.slice(1, -1).trim();
  }
  if (s === '') return null;
  // Tausenderpunkte entfernen, Dezimalkomma -> Punkt
  const normalized = s.replace(/\./g, '').replace(',', '.');
  if (!/^[+-]?\d+(\.\d+)?$/.test(normalized)) {
    throw new DecimalParseError(input);
  }
  // Regex garantiert eine gültige Zahl -> Number() kann hier nicht NaN liefern.
  return Number(normalized);
}
