import { berechneGuvForecast, revenueProFte } from './guv-forecast';

describe('berechneGuvForecast', () => {
  it('leitet GM abs, COGS und Operating Result aus Umsatz + GM% + Other Costs ab', () => {
    const r = berechneGuvForecast({ revenueEur: 1_000_000, grossMarginPct: 40, otherCostsEur: -300_000 });
    expect(r.grossMarginEur).toBe(400_000);
    expect(r.cogsEur).toBe(-600_000); // 400k − 1.000k
    expect(r.operatingResultEur).toBe(100_000); // 400k − 300k
  });

  it('behandelt fehlende Other Costs als 0', () => {
    const r = berechneGuvForecast({ revenueEur: 1_000_000, grossMarginPct: 50, otherCostsEur: null });
    expect(r.grossMarginEur).toBe(500_000);
    expect(r.operatingResultEur).toBe(500_000);
  });

  it('gibt alles null zurück, wenn GM% fehlt (noch nicht geplant)', () => {
    const r = berechneGuvForecast({ revenueEur: 1_000_000, grossMarginPct: null, otherCostsEur: -100_000 });
    expect(r).toEqual({ grossMarginEur: null, cogsEur: null, operatingResultEur: null });
  });
});

describe('revenueProFte', () => {
  it('teilt den annualisierten Umsatz durch die FTE', () => {
    expect(revenueProFte(12_000_000, 60)).toBe(200_000);
  });

  it('gibt null bei fehlender oder nicht-positiver FTE', () => {
    expect(revenueProFte(12_000_000, null)).toBeNull();
    expect(revenueProFte(12_000_000, 0)).toBeNull();
  });
});
