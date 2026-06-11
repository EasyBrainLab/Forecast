import { abwProz } from './abweichung';

/**
 * Pflichtkommentar nötig, wenn die Abweichung von `neu` gegen die Referenz `ref`
 * den Schwellwert STRIKT überschreitet. Referenz 0 mit neu != 0 (abwProz null) -> Kommentar nötig.
 */
export function braucheKommentarGegen(neu: number, ref: number, schwellwertProzent: number): boolean {
  const p = abwProz(neu, ref);
  if (p === null) return neu !== 0;
  return Math.abs(p) > schwellwertProzent;
}

/**
 * Schwellwert verletzt, wenn die Abweichung gegen Budget ODER gegen den Vormonats-Forecast
 * den Schwellwert überschreitet. Nicht vorhandene Referenzen (null/undefined) werden übersprungen.
 */
export function schwellwertVerletzt(
  neu: number,
  referenzen: { budget?: number | null; vormonatForecast?: number | null },
  schwellwertProzent: number,
): boolean {
  const checks: number[] = [];
  if (referenzen.budget !== null && referenzen.budget !== undefined) checks.push(referenzen.budget);
  if (referenzen.vormonatForecast !== null && referenzen.vormonatForecast !== undefined) {
    checks.push(referenzen.vormonatForecast);
  }
  return checks.some((ref) => braucheKommentarGegen(neu, ref, schwellwertProzent));
}
