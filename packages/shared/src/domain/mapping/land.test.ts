import { mapBudgetLandName, normalizeCountryRaw } from './land';

describe('normalizeCountryRaw', () => {
  it('uppercased gültigen Code (pg -> PG, A2)', () => {
    expect(normalizeCountryRaw('pg')).toEqual({ ok: true, iso: 'PG' });
    expect(normalizeCountryRaw(' de ')).toEqual({ ok: true, iso: 'DE' });
  });
  it('leeres Country -> Quarantäne LAND_LEER', () => {
    expect(normalizeCountryRaw('')).toEqual({ ok: false, grund: 'LAND_LEER' });
    expect(normalizeCountryRaw('   ')).toEqual({ ok: false, grund: 'LAND_LEER' });
    expect(normalizeCountryRaw(null)).toEqual({ ok: false, grund: 'LAND_LEER' });
  });
});

describe('mapBudgetLandName', () => {
  const nameEn = new Map<string, string>([
    ['germany', 'DE'],
    ['spain', 'ES'],
  ]);
  it('(Leer) -> Regionsreserve', () => {
    expect(mapBudgetLandName('(Leer)', nameEn)).toEqual({ ok: true, iso: null, regionsreserve: true });
  });
  it('Sonderfälle (Czech/Korea, South/United States/United Kingdom)', () => {
    expect(mapBudgetLandName('Czech', nameEn)).toEqual({ ok: true, iso: 'CZ', regionsreserve: false });
    expect(mapBudgetLandName('Korea, South', nameEn)).toEqual({ ok: true, iso: 'KR', regionsreserve: false });
    expect(mapBudgetLandName('United States', nameEn)).toEqual({ ok: true, iso: 'US', regionsreserve: false });
  });
  it('nameEn-Index (case-insensitiv)', () => {
    expect(mapBudgetLandName('Germany', nameEn)).toEqual({ ok: true, iso: 'DE', regionsreserve: false });
    expect(mapBudgetLandName(' spain ', nameEn)).toEqual({ ok: true, iso: 'ES', regionsreserve: false });
  });
  it('unbekannter Landname -> Quarantäne', () => {
    expect(mapBudgetLandName('Atlantis', nameEn)).toEqual({
      ok: false,
      grund: 'UNBEKANNTER_LANDNAME',
      detail: 'Atlantis',
    });
  });
});
