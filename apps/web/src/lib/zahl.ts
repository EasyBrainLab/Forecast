// Zahl-Eingabe/-Anzeige für Forecast-Werte. Anzeige & Eingabe in kEUR; intern voller EUR.

/**
 * Parst eine Nutzereingabe (kEUR) in eine Zahl. Deutsches Komma ist das Dezimaltrennzeichen;
 * ein Punkt gilt als Dezimaltrennzeichen, wenn KEIN Komma vorhanden ist (englische Eingabe),
 * sonst als Tausendertrenner. Leere/ungültige Eingabe → null.
 *   "6,022" → 6.022 · "6.022" → 6.022 · "1.250,5" → 1250.5 · "1250" → 1250 · "" → null
 */
export function parseKeurEingabe(s: string): number | null {
  const t = s.trim().replace(/[\s€]/g, '');
  if (t === '') return null;
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(norm)) return null;
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

/** Voller EUR-Wert → kEUR-Eingabestring (Komma, bis 3 Nachkommastellen = EUR-genau, ohne Tausenderpunkt). */
export function keurEingabe(eur: number): string {
  return (eur / 1000).toLocaleString('de-DE', { maximumFractionDigits: 3, useGrouping: false });
}

/** Voller EUR-Wert → kEUR-Anzeige (Komma nur wenn nötig, bis 3 Nachkommastellen, mit Tausenderpunkt). */
export function keurAnzeige(eur: number): string {
  return (eur / 1000).toLocaleString('de-DE', { maximumFractionDigits: 3 });
}
