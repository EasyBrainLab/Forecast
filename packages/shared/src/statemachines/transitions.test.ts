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
      findTransition(FORECAST_TRANSITIONS, ForecastStatus.ABGESCHLOSSEN, ForecastStatus.OFFEN),
    ).toBeUndefined();
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
  it('System-Übergänge tauchen nicht als Nutzeraktion auf', () => {
    const ids = erlaubteAktionen(FORECAST_TRANSITIONS, ForecastStatus.BESTAETIGT, Rolle.AGM);
    expect(ids).toHaveLength(0); // F6 ist system-only
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
