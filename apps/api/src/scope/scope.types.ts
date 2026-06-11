import type { Rolle } from '@forecast/shared';

export interface Scope {
  rolle: Rolle;
  /** true = darf alles lesen (VL/BU/ADMIN/SUPPORT, oder AGM mit AGM_CROSS_SICHT). */
  unbeschraenkt: boolean;
  /** true = unbeschränkt NUR lesend (AGM mit Cross-Sicht; Schreiben bleibt auf eigene Region). */
  crossSicht: boolean;
  /** Eigene (forecast-/schreibrelevante) Regionen des AGM. */
  regionCodes: string[];
  /** Eigene Kostenstellen-IDs des AGM. */
  kostenstelleIds: string[];
}
