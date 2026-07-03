import { normalizeSiteName, tokenSet, jaccard, nameAehnlichkeit, findeSiteKandidaten } from './site-match';

describe('normalizeSiteName', () => {
  it('entfernt Diakritika und lowercased', () => {
    expect(normalizeSiteName('Clínica Universitária')).toBe('clinica universitaria');
  });
  it('ersetzt Sonderzeichen durch Space und kollabiert Whitespace', () => {
    expect(normalizeSiteName('H. La Paz / Madrid  (S.A.)')).toBe('h la paz madrid s a');
  });
  it('sonderzeichen-only Name -> leer', () => {
    expect(normalizeSiteName('  ...  ')).toBe('');
  });
});

describe('tokenSet', () => {
  it('bildet die Wortmenge', () => {
    expect([...tokenSet('Hospital La Paz')]).toEqual(['hospital', 'la', 'paz']);
  });
  it('leerer Name -> leere Menge', () => {
    expect(tokenSet('---').size).toBe(0);
  });
});

describe('jaccard', () => {
  it('zwei leere Mengen -> 0', () => {
    expect(jaccard(new Set(), new Set())).toBe(0);
  });
  it('identische Mengen -> 1', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
  });
  it('disjunkte Mengen -> 0', () => {
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0);
  });
  it('teilweise Überlappung', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3);
  });
});

describe('nameAehnlichkeit', () => {
  it('leere Eingabe -> 0 (beide Seiten)', () => {
    expect(nameAehnlichkeit('', 'Hospital')).toBe(0);
    expect(nameAehnlichkeit('Hospital', '   ')).toBe(0);
  });
  it('exakt nach Normalisierung -> 1', () => {
    expect(nameAehnlichkeit('Clínica X', 'clinica  x')).toBe(1);
  });
  it('Wortumstellung/Zusatz -> Token-Jaccard', () => {
    expect(nameAehnlichkeit('Hospital La Paz', 'La Paz Hospital Madrid')).toBeCloseTo(3 / 4);
  });
});

describe('findeSiteKandidaten', () => {
  const kandidaten = [
    { id: '1', name: 'Hospital La Paz' },
    { id: '2', name: 'Clinica Navarra' },
    { id: '3', name: 'Hospital La Paz Madrid' },
  ];
  it('liefert beste Treffer über Schwelle, absteigend, begrenzt', () => {
    const res = findeSiteKandidaten('Hospital La Paz', kandidaten, 0.5, 2);
    expect(res.map((r) => r.id)).toEqual(['1', '3']);
    expect(res[0]?.score).toBe(1);
  });
  it('leere Ergebnisliste, wenn nichts die Schwelle erreicht', () => {
    expect(findeSiteKandidaten('Etwas Ganz Anderes XYZ', kandidaten, 0.9)).toEqual([]);
  });
  it('nutzt Standard-Schwelle (0.5) und -Limit (5)', () => {
    expect(findeSiteKandidaten('Hospital La Paz', kandidaten).map((r) => r.id)).toEqual(['1', '3']);
  });
});
