import { braucheKommentarGegen, schwellwertVerletzt } from './schwellwert';

describe('braucheKommentarGegen', () => {
  it('strikt > Schwellwert -> Kommentar nötig', () => {
    expect(braucheKommentarGegen(111, 100, 10)).toBe(true); // +11%
  });
  it('exakt am Schwellwert -> kein Kommentar (strikt >)', () => {
    expect(braucheKommentarGegen(110, 100, 10)).toBe(false); // +10.0%
  });
  it('innerhalb -> kein Kommentar', () => {
    expect(braucheKommentarGegen(105, 100, 10)).toBe(false);
  });
  it('Referenz 0 und Wert != 0 -> Kommentar nötig', () => {
    expect(braucheKommentarGegen(5, 0, 10)).toBe(true);
  });
  it('Referenz 0 und Wert 0 -> kein Kommentar', () => {
    expect(braucheKommentarGegen(0, 0, 10)).toBe(false);
  });
});

describe('schwellwertVerletzt', () => {
  it('Trigger wenn Budget überschritten', () => {
    expect(schwellwertVerletzt(120, { budget: 100, vormonatForecast: 118 }, 10)).toBe(true);
  });
  it('Trigger wenn Vormonats-Forecast überschritten', () => {
    expect(schwellwertVerletzt(120, { budget: 119, vormonatForecast: 100 }, 10)).toBe(true);
  });
  it('kein Trigger wenn beide innerhalb', () => {
    expect(schwellwertVerletzt(105, { budget: 100, vormonatForecast: 102 }, 10)).toBe(false);
  });
  it('überspringt fehlende Referenzen (null/undefined)', () => {
    expect(schwellwertVerletzt(105, { budget: null }, 10)).toBe(false);
    expect(schwellwertVerletzt(105, {}, 10)).toBe(false);
    expect(schwellwertVerletzt(200, { vormonatForecast: 100 }, 10)).toBe(true);
  });
});
