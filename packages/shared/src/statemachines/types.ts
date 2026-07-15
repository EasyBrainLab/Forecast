import type { Rolle } from '../enums';

export interface Transition<TStatus extends string> {
  id: string;
  von: TStatus;
  nach: TStatus;
  /** Erlaubte Rollen. Zusammen mit `system: true` und leerem Array = nur SYSTEM (z.B. Cron). */
  rollen: readonly Rolle[];
  /** SYSTEM (Cron) darf diesen Übergang. Ohne `rollen` ist er ausschließlich dem System vorbehalten. */
  system?: boolean;
  kommentarPflicht?: boolean | 'BEI_SCHWELLWERT';
  begruendungPflicht?: boolean;
  /** Verhindert Selbstfreigabe (Antragsteller darf diese Stufe nicht selbst freigeben). */
  keineSelbstfreigabe?: boolean;
}

/** Findet die Transition (von -> nach) oder undefined. */
export function findTransition<S extends string>(
  transitions: readonly Transition<S>[],
  von: S,
  nach: S,
): Transition<S> | undefined {
  return transitions.find((t) => t.von === von && t.nach === nach);
}

/**
 * Für eine Rolle in einem Status erlaubte Aktionen. System-only-Übergänge tragen ein leeres
 * `rollen`-Array und fallen dadurch automatisch heraus.
 */
export function erlaubteAktionen<S extends string>(
  transitions: readonly Transition<S>[],
  von: S,
  rolle: Rolle,
): readonly Transition<S>[] {
  return transitions.filter((t) => t.von === von && t.rollen.includes(rolle));
}
