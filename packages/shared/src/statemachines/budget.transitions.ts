import { BudgetAenderungStatus, Rolle } from '../enums';
import type { Transition } from './types';

// Zweistufige Budget-Änderung (§8.3, 4-Augen). Append-only via BudgetAenderungEvent.
export const BUDGET_TRANSITIONS: readonly Transition<BudgetAenderungStatus>[] = [
  {
    id: 'B2',
    von: BudgetAenderungStatus.ENTWURF,
    nach: BudgetAenderungStatus.BEANTRAGT,
    rollen: [Rolle.AGM, Rolle.BU_LEITER],
  },
  {
    id: 'B3',
    von: BudgetAenderungStatus.BEANTRAGT,
    nach: BudgetAenderungStatus.FREIGABE_VERTRIEBSLEITER,
    rollen: [Rolle.VERTRIEBSLEITER],
    keineSelbstfreigabe: true,
  },
  {
    id: 'B4',
    von: BudgetAenderungStatus.BEANTRAGT,
    nach: BudgetAenderungStatus.ABGELEHNT,
    rollen: [Rolle.VERTRIEBSLEITER],
    begruendungPflicht: true,
  },
  {
    id: 'B5',
    von: BudgetAenderungStatus.FREIGABE_VERTRIEBSLEITER,
    nach: BudgetAenderungStatus.FREIGABE_BU_LEITER,
    rollen: [Rolle.BU_LEITER],
    keineSelbstfreigabe: true,
  },
  {
    id: 'B6',
    von: BudgetAenderungStatus.FREIGABE_VERTRIEBSLEITER,
    nach: BudgetAenderungStatus.ABGELEHNT,
    rollen: [Rolle.BU_LEITER],
    begruendungPflicht: true,
  },
  {
    id: 'B7',
    von: BudgetAenderungStatus.FREIGABE_BU_LEITER,
    nach: BudgetAenderungStatus.AKTIV,
    rollen: [Rolle.BU_LEITER],
  },
];
