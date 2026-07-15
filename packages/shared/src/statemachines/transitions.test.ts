import { BudgetAenderungStatus, ForecastStatus, Rolle } from '../enums';
import { BUDGET_TRANSITIONS } from './budget.transitions';
import { FORECAST_TRANSITIONS } from './forecast.transitions';
import { erlaubteAktionen, findTransition } from './types';

describe('findTransition', () => {
  it('findet gültigen Forecast-Übergang', () => {
    const t = findTransition(FORECAST_TRANSITIONS, ForecastStatus.OFFEN, ForecastStatus.BESTAETIGT);
    expect(t?.id).toBe('F1');
  });
  it('liefert undefined bei ungültigem Übergang', () => {
    expect(
      findTransition(FORECAST_TRANSITIONS, ForecastStatus.ABGESCHLOSSEN, ForecastStatus.BESTAETIGT),
    ).toBeUndefined();
  });
  it('F9: ABGESCHLOSSEN → OFFEN (Wiedereröffnung, Begründung Pflicht)', () => {
    const t = findTransition(FORECAST_TRANSITIONS, ForecastStatus.ABGESCHLOSSEN, ForecastStatus.OFFEN);
    expect(t?.id).toBe('F9');
    expect(t?.rollen).toEqual([Rolle.VERTRIEBSLEITER, Rolle.BU_LEITER, Rolle.ADMIN]);
    expect(t?.begruendungPflicht).toBe(true);
  });
});

describe('erlaubteAktionen (Forecast)', () => {
  it('AGM darf in OFFEN bestätigen und anpassen', () => {
    const ids = erlaubteAktionen(FORECAST_TRANSITIONS, ForecastStatus.OFFEN, Rolle.AGM).map((t) => t.id);
    expect(ids).toEqual(['F1', 'F2']);
  });
  it('Vertriebsleiter hat in OFFEN keine Aktion', () => {
    expect(erlaubteAktionen(FORECAST_TRANSITIONS, ForecastStatus.OFFEN, Rolle.VERTRIEBSLEITER)).toHaveLength(
      0,
    );
  });
  it('AGM darf weder abschließen noch wiedereröffnen', () => {
    expect(erlaubteAktionen(FORECAST_TRANSITIONS, ForecastStatus.BESTAETIGT, Rolle.AGM)).toHaveLength(0);
    expect(erlaubteAktionen(FORECAST_TRANSITIONS, ForecastStatus.ABGESCHLOSSEN, Rolle.AGM)).toHaveLength(0);
  });
  it('BU-Leiter darf abschließen, Vertriebsleiter nur wiedereröffnen', () => {
    const bu = erlaubteAktionen(FORECAST_TRANSITIONS, ForecastStatus.BESTAETIGT, Rolle.BU_LEITER).map((t) => t.id);
    expect(bu).toEqual(['F6']);
    const vlZu = erlaubteAktionen(FORECAST_TRANSITIONS, ForecastStatus.BESTAETIGT, Rolle.VERTRIEBSLEITER).map((t) => t.id);
    expect(vlZu).toEqual(['F3']); // VL weist zurück, schließt aber nicht ab
    const vlAuf = erlaubteAktionen(FORECAST_TRANSITIONS, ForecastStatus.ABGESCHLOSSEN, Rolle.VERTRIEBSLEITER).map((t) => t.id);
    expect(vlAuf).toEqual(['F9']);
  });
  it('F5 bleibt system-only (leeres Rollen-Array)', () => {
    const f5 = FORECAST_TRANSITIONS.find((t) => t.id === 'F5');
    expect(f5?.system).toBe(true);
    expect(f5?.rollen).toEqual([]);
    for (const rolle of Object.values(Rolle)) {
      expect(erlaubteAktionen(FORECAST_TRANSITIONS, ForecastStatus.ZURUECKGEWIESEN, rolle)).toHaveLength(0);
    }
  });
});

describe('Budget-Workflow', () => {
  it('VL gibt frei (Stufe 1), BU gibt frei (Stufe 2 -> AKTIV)', () => {
    expect(
      findTransition(
        BUDGET_TRANSITIONS,
        BudgetAenderungStatus.BEANTRAGT,
        BudgetAenderungStatus.FREIGABE_VERTRIEBSLEITER,
      )?.rollen,
    ).toEqual([Rolle.VERTRIEBSLEITER]);
    const b7 = findTransition(
      BUDGET_TRANSITIONS,
      BudgetAenderungStatus.FREIGABE_BU_LEITER,
      BudgetAenderungStatus.AKTIV,
    );
    expect(b7?.rollen).toEqual([Rolle.BU_LEITER]);
  });
  it('Freigabestufen sind gegen Selbstfreigabe markiert', () => {
    const b3 = findTransition(
      BUDGET_TRANSITIONS,
      BudgetAenderungStatus.BEANTRAGT,
      BudgetAenderungStatus.FREIGABE_VERTRIEBSLEITER,
    );
    expect(b3?.keineSelbstfreigabe).toBe(true);
  });
});
