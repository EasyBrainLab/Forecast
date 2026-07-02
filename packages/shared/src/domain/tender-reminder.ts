/**
 * Reminder-Schwellen-Logik für Tender-Fristen (framework-frei, isomorph, 100 % getestet).
 * Bestimmt, welche Erinnerungsstufe JETZT auszulösen ist, und verhindert tägliche Wiederholung.
 */

/** Standard-Erinnerungsstufen in Tagen vor der Abgabefrist (absteigend). */
export const TENDER_REMINDER_SCHWELLEN = [14, 7, 3, 1];

/**
 * Liefert die auszulösende Schwelle (Tage vor Frist) oder null, wenn keine neue Erinnerung fällig ist.
 * - `restTage`: verbleibende Tage bis zur Abgabefrist (>= 0; 0 am Fristtag).
 * - `bereitsErinnert`: kleinste bereits gemeldete Schwelle (null = noch keine).
 * - `schwellen`: Erinnerungsstufen (Default TENDER_REMINDER_SCHWELLEN).
 * Regel: kleinste Schwelle S mit `restTage <= S`; nur auslösen, wenn strikt kleiner als die zuletzt gemeldete.
 */
export function naechsteReminderSchwelle(
  restTage: number,
  bereitsErinnert: number | null,
  schwellen: readonly number[] = TENDER_REMINDER_SCHWELLEN,
): number | null {
  const passende = schwellen.filter((s) => restTage <= s);
  if (passende.length === 0) return null;
  const schwelle = Math.min(...passende);
  if (bereitsErinnert !== null && bereitsErinnert <= schwelle) return null;
  return schwelle;
}
