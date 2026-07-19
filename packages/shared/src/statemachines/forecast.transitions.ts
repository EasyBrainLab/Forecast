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
  // F3/F4: Fertiggemeldeten Forecast auf OFFEN zurücksetzen (z. B. AGM hat versehentlich fertiggemeldet).
  // Leitung + Admin, Begründung Pflicht; F5 führt anschließend systemseitig auf OFFEN.
  {
    id: 'F3',
    von: ForecastStatus.BESTAETIGT,
    nach: ForecastStatus.ZURUECKGEWIESEN,
    rollen: [Rolle.VERTRIEBSLEITER, Rolle.BU_LEITER, Rolle.ADMIN],
    begruendungPflicht: true,
  },
  {
    id: 'F4',
    von: ForecastStatus.ANGEPASST,
    nach: ForecastStatus.ZURUECKGEWIESEN,
    rollen: [Rolle.VERTRIEBSLEITER, Rolle.BU_LEITER, Rolle.ADMIN],
    begruendungPflicht: true,
  },
  { id: 'F5', von: ForecastStatus.ZURUECKGEWIESEN, nach: ForecastStatus.OFFEN, rollen: [], system: true },
  // F6–F8: Monatsabschluss. Cron (system) und manuell durch die Leitung — Kaskade auf ältere Perioden.
  {
    id: 'F6',
    von: ForecastStatus.BESTAETIGT,
    nach: ForecastStatus.ABGESCHLOSSEN,
    rollen: [Rolle.BU_LEITER, Rolle.ADMIN],
    system: true,
  },
  {
    id: 'F7',
    von: ForecastStatus.ANGEPASST,
    nach: ForecastStatus.ABGESCHLOSSEN,
    rollen: [Rolle.BU_LEITER, Rolle.ADMIN],
    system: true,
  },
  {
    id: 'F8',
    von: ForecastStatus.OFFEN,
    nach: ForecastStatus.ABGESCHLOSSEN,
    rollen: [Rolle.BU_LEITER, Rolle.ADMIN],
    system: true,
  },
  // F9: Wiedereröffnung (Korrekturfall). Kaskadiert auf alle jüngeren abgeschlossenen Perioden.
  {
    id: 'F9',
    von: ForecastStatus.ABGESCHLOSSEN,
    nach: ForecastStatus.OFFEN,
    rollen: [Rolle.VERTRIEBSLEITER, Rolle.BU_LEITER, Rolle.ADMIN],
    begruendungPflicht: true,
  },
  // F10/F11: Fremdüberschreibung eines bereits fertiggemeldeten Forecasts durch die Leitung.
  // Ergebnis ist stets ANGEPASST (F11 als Self-Loop für erneute Überschreibung), Begründung Pflicht;
  // der AGM wird informiert und muss die Änderung zur Kenntnis nehmen.
  {
    id: 'F10',
    von: ForecastStatus.BESTAETIGT,
    nach: ForecastStatus.ANGEPASST,
    rollen: [Rolle.VERTRIEBSLEITER, Rolle.BU_LEITER],
    begruendungPflicht: true,
  },
  {
    id: 'F11',
    von: ForecastStatus.ANGEPASST,
    nach: ForecastStatus.ANGEPASST,
    rollen: [Rolle.VERTRIEBSLEITER, Rolle.BU_LEITER],
    begruendungPflicht: true,
  },
];
