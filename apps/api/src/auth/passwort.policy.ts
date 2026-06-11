import { BadRequestException } from '@nestjs/common';

// Passwort-Policy (§7.1): min. 12 Zeichen, je 1 Groß-/Kleinbuchstabe, Ziffer, Sonderzeichen.
export const PASSWORT_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;
export const PASSWORT_MELDUNG =
  'Passwort muss mind. 12 Zeichen mit Groß-, Kleinbuchstaben, Ziffer und Sonderzeichen enthalten.';

// Pragmatische Auswahl häufiger Passwörter (Stellvertreter für Top-1000-Liste).
const HAEUFIGE_PASSWOERTER = new Set([
  'passwort1234',
  'password1234',
  'qwertzuiopü1',
  'administrator',
  '123456789012',
  'forecast2026!',
]);

/** Validiert die Passwort-Policy serverseitig inkl. E-Mail-Localpart- und Blocklist-Prüfung. */
export function validatePasswortPolicy(passwort: string, email: string): void {
  if (!PASSWORT_REGEX.test(passwort)) {
    throw new BadRequestException(PASSWORT_MELDUNG);
  }
  const localpart = email.split('@')[0]?.toLowerCase() ?? '';
  if (localpart.length >= 3 && passwort.toLowerCase().includes(localpart)) {
    throw new BadRequestException('Passwort darf nicht den E-Mail-Namen enthalten.');
  }
  if (HAEUFIGE_PASSWOERTER.has(passwort.toLowerCase())) {
    throw new BadRequestException('Passwort ist zu häufig/unsicher.');
  }
}
