import {
  forecastRest,
  formatPeriode,
  istMonatIstwert,
  istYtd,
  istYtdUnits,
  parsePeriode,
  yee,
  type IstMonatswert,
  type MonatswerteRest,
  type Stichtag,
} from './yee';

const stichtag: Stichtag = { aktuellesJahr: 2026, aktuellerMonat: 4, monatAbgeschlossen: false };

describe('istMonatIstwert', () => {
  it('Vorjahr immer Ist', () => expect(istMonatIstwert(2025, 12, stichtag)).toBe(true));
  it('Folgejahr nie Ist', () => expect(istMonatIstwert(2027, 1, stichtag)).toBe(false));
  it('zurückliegender Monat im laufenden Jahr = Ist', () =>
    expect(istMonatIstwert(2026, 3, stichtag)).toBe(true));
  it('künftiger Monat im laufenden Jahr = Forecast', () =>
    expect(istMonatIstwert(2026, 5, stichtag)).toBe(false));
  it('laufender Monat hängt von monatAbgeschlossen ab', () => {
    expect(istMonatIstwert(2026, 4, stichtag)).toBe(false);
    expect(istMonatIstwert(2026, 4, { ...stichtag, monatAbgeschlossen: true })).toBe(true);
  });
});

describe('istYtd / istYtdUnits', () => {
  const ist: IstMonatswert[] = [
    { jahr: 2026, monat: 1, eur: 1000, units: 10 },
    { jahr: 2026, monat: 2, eur: 2000, units: 20 },
    { jahr: 2026, monat: 3, eur: 3000 }, // units undefined -> 0
    { jahr: 2026, monat: 5, eur: 9999, units: 99 }, // künftig -> nicht YTD
    { jahr: 2025, monat: 6, eur: 500, units: 5 }, // anderes Jahr
  ];
  it('summiert nur abgelaufene Monate des Jahres', () => {
    expect(istYtd(ist, 2026, stichtag)).toBe(6000);
  });
  it('summiert Units (null/undefined = 0)', () => {
    expect(istYtdUnits(ist, 2026, stichtag)).toBe(30);
  });
  it('berücksichtigt negative Storno-Salden', () => {
    const mitStorno: IstMonatswert[] = [
      { jahr: 2026, monat: 1, eur: 1000 },
      { jahr: 2026, monat: 2, eur: -250 },
    ];
    expect(istYtd(mitStorno, 2026, stichtag)).toBe(750);
  });
});

describe('forecastRest', () => {
  const rest: MonatswerteRest = {
    '2026-03': { eur: 111 }, // bereits Ist -> ignoriert
    '2026-04': { eur: 4000 }, // laufender Monat, nicht abgeschlossen -> Forecast
    '2026-05': { eur: 5000 },
    '2025-12': { eur: 7777 }, // anderes Jahr -> ignoriert
    kaputt: { eur: 1 }, // ungültiger Periodenschlüssel -> ignoriert
  };
  it('summiert nur künftige Monate des Jahres', () => {
    expect(forecastRest(rest, 2026, stichtag)).toBe(9000);
  });
});

describe('yee', () => {
  it('YEE = Ist YTD + Forecast Rest', () => {
    const ist: IstMonatswert[] = [
      { jahr: 2026, monat: 1, eur: 1000 },
      { jahr: 2026, monat: 2, eur: 2000 },
      { jahr: 2026, monat: 3, eur: 3000 },
    ];
    const rest: MonatswerteRest = { '2026-04': { eur: 4000 }, '2026-05': { eur: 5000 } };
    expect(yee(ist, rest, 2026, stichtag)).toBe(15000);
  });
});

describe('parsePeriode / formatPeriode', () => {
  it('parst gültige Periode', () => expect(parsePeriode('2026-07')).toEqual({ jahr: 2026, monat: 7 }));
  it('liefert null bei falschem Format', () => expect(parsePeriode('2026/7')).toBeNull());
  it('liefert null bei ungültigem Monat', () => {
    expect(parsePeriode('2026-13')).toBeNull();
    expect(parsePeriode('2026-00')).toBeNull();
  });
  it('formatiert mit Null-Padding', () => expect(formatPeriode(2026, 4)).toBe('2026-04'));
});
