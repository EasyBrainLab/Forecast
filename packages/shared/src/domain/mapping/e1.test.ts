import { E1Kategorie } from '../../enums';
import { mapE1 } from './e1';

describe('mapE1', () => {
  it('mappt alle drei Namensräume (CSV/Budget/Konsolidierung)', () => {
    expect(mapE1('1_Implants', 252)).toEqual({ ok: true, e1: E1Kategorie.IMPLANT });
    expect(mapE1('Implant', 252)).toEqual({ ok: true, e1: E1Kategorie.IMPLANT });
    expect(mapE1('Revenue Implants', 252)).toEqual({ ok: true, e1: E1Kategorie.IMPLANT });
    expect(mapE1('2_Ophthalmo', 253)).toEqual({ ok: true, e1: E1Kategorie.OPHTHALMO });
    expect(mapE1('3_Afterloader', 254)).toEqual({ ok: true, e1: E1Kategorie.AFTERLOADER });
    expect(mapE1('6_Other', 255)).toEqual({ ok: true, e1: E1Kategorie.OTHER });
  });
  it('Sammel-Kostenstelle hat Vorrang -> ZENTRAL', () => {
    expect(mapE1('1_Implants', 262)).toEqual({ ok: true, e1: E1Kategorie.ZENTRAL });
  });
  it('unbekannte E1 -> Quarantäne', () => {
    expect(mapE1('Quatsch', 252)).toEqual({ ok: false, grund: 'UNBEKANNTE_E1', detail: 'Quatsch' });
  });
});
