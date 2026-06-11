import { BUDGET_GRUPPE_TO_REGION, KST_TO_REGION, OWNER_HINT_TO_REGION, REGION_ZENTRAL } from '../../constants';

/** Region über die Kostenstellennummer (alleinige Wahrheit für die Ist-Reconciliation). */
export function regionByKst(kstNummer: number): string | null {
  return KST_TO_REGION[kstNummer] ?? null;
}

/** Region über die Budget-Excel-"KST Gruppe" (AES->EP, Radiotherapie->CS). */
export function regionByBudgetGruppe(gruppe: string): string | null {
  return BUDGET_GRUPPE_TO_REGION[gruppe.trim()] ?? null;
}

/** Region-Hinweis über den Ist-CSV "KostenstellenOwner" (nur Plausibilisierung). */
export function regionByOwnerHint(owner: string): string | null {
  return OWNER_HINT_TO_REGION[owner.trim()] ?? null;
}

export function istZentral(regionCode: string): boolean {
  return regionCode === REGION_ZENTRAL;
}
