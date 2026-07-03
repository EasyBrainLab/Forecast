import { naechsteReminderSchwelle, TENDER_REMINDER_SCHWELLEN } from './tender-reminder';

describe('naechsteReminderSchwelle', () => {
  it('keine Erinnerung, solange die Frist weiter weg als die größte Schwelle ist', () => {
    expect(naechsteReminderSchwelle(30, null)).toBeNull();
    expect(naechsteReminderSchwelle(15, null)).toBeNull();
  });

  it('löst die erste Stufe (14) beim Erreichen von 14 Tagen aus (MVP-Abnahmekriterium)', () => {
    expect(naechsteReminderSchwelle(14, null)).toBe(14);
  });

  it('meldet die größte noch passende Stufe (10 Tage -> 14)', () => {
    expect(naechsteReminderSchwelle(10, null)).toBe(14);
  });

  it('eskaliert auf die nächste Stufe, wenn bereits eine gröbere gemeldet wurde', () => {
    expect(naechsteReminderSchwelle(7, 14)).toBe(7);
    expect(naechsteReminderSchwelle(3, 7)).toBe(3);
    expect(naechsteReminderSchwelle(1, 3)).toBe(1);
  });

  it('wiederholt dieselbe Stufe nicht (Idempotenz)', () => {
    expect(naechsteReminderSchwelle(7, 7)).toBeNull();
    expect(naechsteReminderSchwelle(5, 7)).toBeNull();
  });

  it('löst am Fristtag (0 Tage) die 1-Tages-Stufe aus', () => {
    expect(naechsteReminderSchwelle(0, null)).toBe(1);
    expect(naechsteReminderSchwelle(0, 1)).toBeNull();
  });

  it('respektiert eine benutzerdefinierte Schwellenliste', () => {
    expect(naechsteReminderSchwelle(20, null, [30, 20, 10])).toBe(20);
    expect(naechsteReminderSchwelle(20, 30, [30, 20, 10])).toBe(20);
  });

  it('hat die Standardstufen [14, 7, 3, 1]', () => {
    expect(TENDER_REMINDER_SCHWELLEN).toEqual([14, 7, 3, 1]);
  });
});
