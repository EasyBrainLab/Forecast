// Spiegel der Prisma-Enums (UPPERCASE). Single source of truth für isomorphe Nutzung (api + web).

export const Rolle = {
  AGM: 'AGM',
  VERTRIEBSLEITER: 'VERTRIEBSLEITER',
  BU_LEITER: 'BU_LEITER',
  ADMIN: 'ADMIN',
  SUPPORT: 'SUPPORT',
} as const;
export type Rolle = (typeof Rolle)[keyof typeof Rolle];

export const UserStatus = {
  EINGELADEN: 'EINGELADEN',
  VERIFIZIERT: 'VERIFIZIERT',
  DEAKTIVIERT: 'DEAKTIVIERT',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const Company = { BBD: 'BBD', BBE: 'BBE', BBF: 'BBF', BMW: 'BMW' } as const;
export type Company = (typeof Company)[keyof typeof Company];

export const E1Kategorie = {
  IMPLANT: 'IMPLANT',
  OPHTHALMO: 'OPHTHALMO',
  AFTERLOADER: 'AFTERLOADER',
  OTHER: 'OTHER',
  ZENTRAL: 'ZENTRAL',
} as const;
export type E1Kategorie = (typeof E1Kategorie)[keyof typeof E1Kategorie];

export const KennzahlTyp = { REVENUE: 'REVENUE', COGS: 'COGS', OTHER_COSTS: 'OTHER_COSTS' } as const;
export type KennzahlTyp = (typeof KennzahlTyp)[keyof typeof KennzahlTyp];

export const BudgetStatus = { AKTIV: 'AKTIV', HISTORISIERT: 'HISTORISIERT' } as const;
export type BudgetStatus = (typeof BudgetStatus)[keyof typeof BudgetStatus];

export const BudgetAenderungStatus = {
  ENTWURF: 'ENTWURF',
  BEANTRAGT: 'BEANTRAGT',
  FREIGABE_VERTRIEBSLEITER: 'FREIGABE_VERTRIEBSLEITER',
  FREIGABE_BU_LEITER: 'FREIGABE_BU_LEITER',
  ABGELEHNT: 'ABGELEHNT',
  AKTIV: 'AKTIV',
} as const;
export type BudgetAenderungStatus = (typeof BudgetAenderungStatus)[keyof typeof BudgetAenderungStatus];

export const ForecastStatus = {
  OFFEN: 'OFFEN',
  BESTAETIGT: 'BESTAETIGT',
  ANGEPASST: 'ANGEPASST',
  ZURUECKGEWIESEN: 'ZURUECKGEWIESEN',
  ABGESCHLOSSEN: 'ABGESCHLOSSEN',
} as const;
export type ForecastStatus = (typeof ForecastStatus)[keyof typeof ForecastStatus];

export const ImportStatus = {
  HOCHGELADEN: 'HOCHGELADEN',
  VALIDIERT: 'VALIDIERT',
  ABGESCHLOSSEN: 'ABGESCHLOSSEN',
  FEHLGESCHLAGEN: 'FEHLGESCHLAGEN',
} as const;
export type ImportStatus = (typeof ImportStatus)[keyof typeof ImportStatus];

export const QuarantaeneStatus = { OFFEN: 'OFFEN', GEKLAERT: 'GEKLAERT', VERWORFEN: 'VERWORFEN' } as const;
export type QuarantaeneStatus = (typeof QuarantaeneStatus)[keyof typeof QuarantaeneStatus];

export const QuarantaeneGrund = {
  UNBEKANNTE_KOSTENSTELLE: 'UNBEKANNTE_KOSTENSTELLE',
  LAND_LEER: 'LAND_LEER',
  UNBEKANNTES_LAND: 'UNBEKANNTES_LAND',
  UNBEKANNTER_LANDNAME: 'UNBEKANNTER_LANDNAME',
  UNBEKANNTE_E1: 'UNBEKANNTE_E1',
  UNBEKANNTE_E2: 'UNBEKANNTE_E2',
  WERT_LEER: 'WERT_LEER',
  VORZEICHEN_INKONSISTENT: 'VORZEICHEN_INKONSISTENT',
  UNBEKANNTER_MONAT: 'UNBEKANNTER_MONAT',
  RECID_DUP_IN_DATEI: 'RECID_DUP_IN_DATEI',
  COMPANY_UNBEKANNT: 'COMPANY_UNBEKANNT',
} as const;
export type QuarantaeneGrund = (typeof QuarantaeneGrund)[keyof typeof QuarantaeneGrund];

export const AuditAktion = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  STATUS_WECHSEL: 'STATUS_WECHSEL',
  IMPORT: 'IMPORT',
  EXPORT: 'EXPORT',
  LOGIN: 'LOGIN',
  LOGIN_FEHLER: 'LOGIN_FEHLER',
  MAIL_FEHLER: 'MAIL_FEHLER',
} as const;
export type AuditAktion = (typeof AuditAktion)[keyof typeof AuditAktion];
