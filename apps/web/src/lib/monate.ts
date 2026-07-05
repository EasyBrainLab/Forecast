/** Locale-abhängige Monatskürzel (Index 0 = Januar) über Intl — keine eigenen Übersetzungslisten nötig. */
export function monKurz(locale: string): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { month: 'short' });
  return Array.from({ length: 12 }, (_, i) => fmt.format(new Date(Date.UTC(2026, i, 1))).replace('.', ''));
}
