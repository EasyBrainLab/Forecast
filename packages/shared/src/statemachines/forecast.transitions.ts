import { ForecastStatus, Rolle } from '../enums';
import type { Transition } from './types';

// Forecast-Zyklus (§8.2). Jede Transition erzeugt eine neue ForecastVersion (append-only).
export const FORECAST_TRANSITIONS: readonly Transition<ForecastStatus>[] = [
  { id: 'F1', von: ForecastStatus.OFFEN, nach: ForecastStatus.BESTAETIGT, rollen: [Rolle.AGM] },
  {
    id: 'F2',
    von: ForecastStatus.OFFEN,
    nach: ForecastStatus.ANGEPASST,
    rollen: [Rolle.AGM],
    kommentarPflicht: 'BEI_SCHWELLWERT',
  },
  {
    id: 'F3',
    von: ForecastStatus.BESTAETIGT,
    nach: ForecastStatus.ZURUECKGEWIESEN,
    rollen: [Rolle.VERTRIEBSLEITER],
    begruendungPflicht: true,
  },
  {
    id: 'F4',
    von: ForecastStatus.ANGEPASST,
    nach: ForecastStatus.ZURUECKGEWIESEN,
    rollen: [Rolle.VERTRIEBSLEITER],
    begruendungPflicht: true,
  },
  { id: 'F5', von: ForecastStatus.ZURUECKGEWIESEN, nach: ForecastStatus.OFFEN, rollen: [], system: true },
  { id: 'F6', von: ForecastStatus.BESTAETIGT, nach: ForecastStatus.ABGESCHLOSSEN, rollen: [], system: true },
  { id: 'F7', von: ForecastStatus.ANGEPASST, nach: ForecastStatus.ABGESCHLOSSEN, rollen: [], system: true },
  { id: 'F8', von: ForecastStatus.OFFEN, nach: ForecastStatus.ABGESCHLOSSEN, rollen: [], system: true },
];
