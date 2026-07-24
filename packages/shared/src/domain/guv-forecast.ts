// P&L-Planung (G&V-Forecast) der Konsolidierung — isomorphe Berechnung.
// Der BU-Leiter plant je offenem Monat Gross-Margin-% und Other Costs; das operative Ergebnis
// wird daraus berechnet. Diese Funktionen werden SOWOHL im Backend (autoritative Berechnung für
// Persistenz/Export) ALS AUCH im Frontend (Live-Recalc bei Eingabe) genutzt — eine Wahrheit.
//
// Konventionen: alle Geldwerte in vollem EUR. Kosten sind NEGATIV (COGS, Other Costs), damit
//   operativesErgebnis = grossMargin + otherCosts  gilt (Vorzeichen wie in der Controlling-G&V).

export interface GuvForecastEingabe {
  /** Umsatz des Monats in vollem EUR (aus dem Tool: Ist bzw. Forecast). */
  revenueEur: number;
  /** Gross-Margin in Prozent (z. B. 42.5). null = noch nicht geplant. */
  grossMarginPct: number | null;
  /** Sonstige Kosten in vollem EUR, NEGATIV. null = noch nicht geplant. */
  otherCostsEur: number | null;
}

export interface GuvForecastKennzahlen {
  /** Deckungsbeitrag absolut = Umsatz × GM% (voller EUR). null, wenn GM% fehlt. */
  grossMarginEur: number | null;
  /** COGS = grossMargin − revenue (negativ). null, wenn GM% fehlt. */
  cogsEur: number | null;
  /** Operatives Ergebnis = grossMargin + otherCosts (voller EUR). null, wenn GM% fehlt. */
  operatingResultEur: number | null;
}

/** Leitet aus Umsatz + GM% (+ Other Costs) die abhängigen G&V-Kennzahlen ab. */
export function berechneGuvForecast(e: GuvForecastEingabe): GuvForecastKennzahlen {
  if (e.grossMarginPct == null) {
    return { grossMarginEur: null, cogsEur: null, operatingResultEur: null };
  }
  const grossMarginEur = e.revenueEur * (e.grossMarginPct / 100);
  const cogsEur = grossMarginEur - e.revenueEur; // negativ
  const operatingResultEur = grossMarginEur + (e.otherCostsEur ?? 0);
  return { grossMarginEur, cogsEur, operatingResultEur };
}

/** Revenue pro FTE, annualisiert. `revenueAnnualisiertEur` = Monatsumsatz × 12 bzw. FY-Umsatz. */
export function revenueProFte(revenueAnnualisiertEur: number, fte: number | null): number | null {
  return fte && fte > 0 ? revenueAnnualisiertEur / fte : null;
}
