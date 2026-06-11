import { istZentral, regionByBudgetGruppe, regionByKst, regionByOwnerHint } from './region';

describe('regionByKst', () => {
  it('Sales-Kostenstellen', () => {
    expect(regionByKst(252)).toBe('EP');
    expect(regionByKst(253)).toBe('WIA');
    expect(regionByKst(254)).toBe('EMA');
    expect(regionByKst(255)).toBe('AGC');
    expect(regionByKst(256)).toBe('CS');
    expect(regionByKst(257)).toBe('CS');
  });
  it('Sammel-Kostenstellen -> ZENTRAL', () => {
    expect(regionByKst(262)).toBe('ZENTRAL');
    expect(regionByKst(264)).toBe('ZENTRAL');
    expect(regionByKst(690)).toBe('ZENTRAL');
  });
  it('unbekannte KST -> null', () => expect(regionByKst(999)).toBeNull());
});

describe('regionByBudgetGruppe', () => {
  it('AES -> EP, Radiotherapie -> CS', () => {
    expect(regionByBudgetGruppe('AES')).toBe('EP');
    expect(regionByBudgetGruppe('Radiotherapie')).toBe('CS');
    expect(regionByBudgetGruppe(' AGC ')).toBe('AGC');
  });
  it('unbekannte Gruppe -> null', () => expect(regionByBudgetGruppe('XYZ')).toBeNull());
});

describe('regionByOwnerHint', () => {
  it('mappt Owner-Kürzel', () => {
    expect(regionByOwnerHint('aes')).toBe('EP');
    expect(regionByOwnerHint('CS')).toBe('CS');
  });
  it('unbekannter Owner -> null', () => expect(regionByOwnerHint('dwb')).toBeNull());
});

describe('istZentral', () => {
  it('erkennt ZENTRAL', () => {
    expect(istZentral('ZENTRAL')).toBe(true);
    expect(istZentral('EP')).toBe(false);
  });
});
