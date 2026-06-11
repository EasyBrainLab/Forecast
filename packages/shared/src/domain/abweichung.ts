// Abweichungslogik (§5.3). Prozentwert null = "n/a" (Referenz 0, Wert != 0).

export function abwAbs(a: number, b: number): number {
  return a - b;
}

/**
 * Prozentuale Abweichung von a gegenüber b.
 * - b == 0 && a == 0 -> 0
 * - b == 0 && a != 0 -> null ("n/a", Division durch 0)
 * - sonst (a - b) / |b| * 100  (|b| im Nenner: negative Referenzen z.B. KST 262 = -13.021)
 */
export function abwProz(a: number, b: number): number | null {
  if (b === 0) {
    return a === 0 ? 0 : null;
  }
  return ((a - b) / Math.abs(b)) * 100;
}

/** Anzeige-Skalierung: voller EUR -> kEUR (1 Nachkommastelle) bzw. EUR (2 Nachkommastellen). */
export function skaliereAnzeige(eur: number, einheit: 'kEUR' | 'EUR'): number {
  if (einheit === 'kEUR') {
    return Math.round((eur / 1000) * 10) / 10;
  }
  return Math.round(eur * 100) / 100;
}
