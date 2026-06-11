// YEE-Logik (Year-End-Estimate): abgelaufene Monate = Ist, künftige Monate = Forecast.
// Framework-frei und vollständig testbar (§5.3).

export interface IstMonatswert {
  jahr: number;
  monat: number; // 1..12
  eur: number;
  units?: number | null;
}

export interface MonatswertRest {
  eur: number;
  units?: number | null;
}

// monatswerteRest: { "JJJJ-MM": { eur, units } }
export type MonatswerteRest = Record<string, MonatswertRest>;

export interface Stichtag {
  aktuellesJahr: number;
  aktuellerMonat: number; // 1..12
  /** true, sobald der Ist-Import des laufenden Monats abgeschlossen ist (Ist ersetzt Forecast für m == aktuellerMonat). */
  monatAbgeschlossen: boolean;
}

/** Gilt (jahr,monat) am Stichtag bereits als Ist (true) oder noch als Forecast (false)? */
export function istMonatIstwert(jahr: number, monat: number, stichtag: Stichtag): boolean {
  if (jahr < stichtag.aktuellesJahr) return true;
  if (jahr > stichtag.aktuellesJahr) return false;
  if (monat < stichtag.aktuellerMonat) return true;
  if (monat === stichtag.aktuellerMonat) return stichtag.monatAbgeschlossen;
  return false;
}

/** Summe der Ist-Werte des Jahres, die am Stichtag als Ist gelten (YTD). */
export function istYtd(istWerte: readonly IstMonatswert[], jahr: number, stichtag: Stichtag): number {
  return istWerte.reduce(
    (summe, w) => (w.jahr === jahr && istMonatIstwert(w.jahr, w.monat, stichtag) ? summe + w.eur : summe),
    0,
  );
}

/** Summe der Ist-Units des Jahres (YTD), null-Werte zählen als 0. */
export function istYtdUnits(istWerte: readonly IstMonatswert[], jahr: number, stichtag: Stichtag): number {
  return istWerte.reduce(
    (summe, w) =>
      w.jahr === jahr && istMonatIstwert(w.jahr, w.monat, stichtag) ? summe + (w.units ?? 0) : summe,
    0,
  );
}

/** Summe der Forecast-Restmonate des Jahres (nur Monate, die noch NICHT Ist sind). */
export function forecastRest(monatswerteRest: MonatswerteRest, jahr: number, stichtag: Stichtag): number {
  let summe = 0;
  for (const [periode, wert] of Object.entries(monatswerteRest)) {
    const parsed = parsePeriode(periode);
    if (parsed === null) continue;
    if (parsed.jahr !== jahr) continue;
    if (istMonatIstwert(parsed.jahr, parsed.monat, stichtag)) continue;
    summe += wert.eur;
  }
  return summe;
}

/** YEE = Ist YTD + Forecast Restmonate. */
export function yee(
  istWerte: readonly IstMonatswert[],
  monatswerteRest: MonatswerteRest,
  jahr: number,
  stichtag: Stichtag,
): number {
  return istYtd(istWerte, jahr, stichtag) + forecastRest(monatswerteRest, jahr, stichtag);
}

export function parsePeriode(periode: string): { jahr: number; monat: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(periode);
  if (!m) return null;
  const jahr = Number(m[1]);
  const monat = Number(m[2]);
  if (monat < 1 || monat > 12) return null;
  return { jahr, monat };
}

export function formatPeriode(jahr: number, monat: number): string {
  return `${jahr}-${String(monat).padStart(2, '0')}`;
}
