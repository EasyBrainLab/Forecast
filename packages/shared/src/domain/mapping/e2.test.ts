import { E1Kategorie } from '../../enums';
import { e2UnbekanntName, mapE2 } from './e2';

describe('mapE2', () => {
  it('löst Synonyme mit/ohne "+" auf denselben kanonischen Namen', () => {
    expect(mapE2('Stranded Seeds S06/S17+', E1Kategorie.IMPLANT)).toEqual({
      ok: true,
      name: 'Stranded Seeds S06/S17',
      e1: E1Kategorie.IMPLANT,
      istPlatzhalter: false,
    });
    expect(mapE2('Loose Seeds S06/S17', E1Kategorie.IMPLANT).ok).toBe(true);
  });
  it('Applicators & Equipment Mick -> AFTERLOADER (A4)', () => {
    expect(mapE2('Applicators & Equipment Mick', E1Kategorie.AFTERLOADER)).toEqual({
      ok: true,
      name: 'Applicators & Equipment Mick',
      e1: E1Kategorie.AFTERLOADER,
      istPlatzhalter: false,
    });
  });
  it('leeres KTREB2 -> Platzhalter "Unbekannt (E1)", keine Quarantäne', () => {
    expect(mapE2('', E1Kategorie.OTHER)).toEqual({
      ok: true,
      name: 'Unbekannt (OTHER)',
      e1: E1Kategorie.OTHER,
      istPlatzhalter: true,
    });
    expect(mapE2(null, E1Kategorie.IMPLANT).ok).toBe(true);
  });
  it('generisches "Other" folgt der KTREB1-E1', () => {
    expect(mapE2('Other', E1Kategorie.OTHER)).toEqual({
      ok: true,
      name: 'Other',
      e1: E1Kategorie.OTHER,
      istPlatzhalter: false,
    });
  });
  it('unbekannte E2 -> Quarantäne', () => {
    expect(mapE2('Foobar', E1Kategorie.OTHER)).toEqual({
      ok: false,
      grund: 'UNBEKANNTE_E2',
      detail: 'Foobar',
    });
  });
  it('e2UnbekanntName erzeugt den Platzhalternamen', () => {
    expect(e2UnbekanntName(E1Kategorie.AFTERLOADER)).toBe('Unbekannt (AFTERLOADER)');
  });
});
