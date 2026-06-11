import { DecimalParseError, parseDecimalDe } from './parse-decimal-de';

describe('parseDecimalDe', () => {
  it('parst negatives, gequotetes Format (Ist-CSV)', () => {
    expect(parseDecimalDe('"-2493,00"')).toBe(-2493);
  });
  it('parst Tausenderpunkt + Dezimalkomma', () => {
    expect(parseDecimalDe('1.234,56')).toBeCloseTo(1234.56, 5);
  });
  it('parst ungequotetes Format', () => {
    expect(parseDecimalDe('107,50')).toBeCloseTo(107.5, 5);
  });
  it('liefert null bei null/undefined', () => {
    expect(parseDecimalDe(null)).toBeNull();
    expect(parseDecimalDe(undefined)).toBeNull();
  });
  it('liefert null bei leerem String und leeren Quotes', () => {
    expect(parseDecimalDe('')).toBeNull();
    expect(parseDecimalDe('   ')).toBeNull();
    expect(parseDecimalDe('""')).toBeNull();
  });
  it('parst positiven Wert mit explizitem Pluszeichen', () => {
    expect(parseDecimalDe('+42')).toBe(42);
  });
  it('wirft DecimalParseError bei nicht-numerischem Inhalt', () => {
    expect(() => parseDecimalDe('abc')).toThrow(DecimalParseError);
    expect(() => parseDecimalDe('"x"')).toThrow(DecimalParseError);
    expect(() => parseDecimalDe('1,2,3')).toThrow(DecimalParseError);
  });
});
