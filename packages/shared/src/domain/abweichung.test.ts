import { abwAbs, abwProz, skaliereAnzeige } from './abweichung';

describe('abwAbs', () => {
  it('berechnet absolute Abweichung', () => {
    expect(abwAbs(120, 100)).toBe(20);
    expect(abwAbs(80, 100)).toBe(-20);
  });
});

describe('abwProz', () => {
  it('positive und negative Abweichung', () => {
    expect(abwProz(110, 100)).toBeCloseTo(10, 5);
    expect(abwProz(90, 100)).toBeCloseTo(-10, 5);
  });
  it('Referenz 0 und Wert 0 -> 0', () => expect(abwProz(0, 0)).toBe(0));
  it('Referenz 0 und Wert != 0 -> null (n/a)', () => expect(abwProz(5, 0)).toBeNull());
  it('negative Referenz nutzt |b| im Nenner (KST 262 = -13021)', () => {
    // a=-13021*1.1 = -14323.1 ggü. b=-13021 -> -10% (|b| im Nenner)
    expect(abwProz(-14323.1, -13021)).toBeCloseTo(-10, 3);
  });
});

describe('skaliereAnzeige', () => {
  it('kEUR auf 1 Nachkommastelle', () => expect(skaliereAnzeige(45146604.02, 'kEUR')).toBe(45146.6));
  it('EUR auf 2 Nachkommastellen', () => expect(skaliereAnzeige(1234.567, 'EUR')).toBe(1234.57));
});
