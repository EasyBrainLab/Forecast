import { E1Kategorie } from './enums';

// ─────────────── REGION (KST-Brücke ist alleinige Wahrheit) ───────────────
export const REGION_ZENTRAL = 'ZENTRAL';

export const KST_TO_REGION: Readonly<Record<number, string>> = {
  252: 'EP',
  253: 'WIA',
  254: 'EMA',
  255: 'AGC',
  256: 'CS',
  257: 'CS',
  // Sammel-Kostenstellen → ZENTRAL (kein Forecast)
  110: REGION_ZENTRAL,
  150: REGION_ZENTRAL,
  200: REGION_ZENTRAL,
  220: REGION_ZENTRAL,
  262: REGION_ZENTRAL,
  264: REGION_ZENTRAL,
  270: REGION_ZENTRAL,
  280: REGION_ZENTRAL,
  500: REGION_ZENTRAL,
  690: REGION_ZENTRAL,
};

// Budget-Excel "KST Gruppe" → kanonischer Region-Code (A6)
export const BUDGET_GRUPPE_TO_REGION: Readonly<Record<string, string>> = {
  AGC: 'AGC',
  EMA: 'EMA',
  AES: 'EP',
  WIA: 'WIA',
  Radiotherapie: 'CS',
};

// Ist-CSV "KostenstellenOwner" → Region (nur Plausibilisierung/Warnung, NICHT führend)
export const OWNER_HINT_TO_REGION: Readonly<Record<string, string>> = {
  aes: 'EP',
  wia: 'WIA',
  ema: 'EMA',
  agc: 'AGC',
  CS: 'CS',
};

export const SAMMEL_KOSTENSTELLEN: readonly number[] = [110, 150, 200, 220, 262, 264, 270, 280, 500, 690];

// ─────────────── PRODUKTGRUPPE E1 (3 Namensräume → Enum) ───────────────
export const E1_LOOKUP: Readonly<Record<string, E1Kategorie>> = {
  // CSV (KTREB1)
  '1_Implants': E1Kategorie.IMPLANT,
  '2_Ophthalmo': E1Kategorie.OPHTHALMO,
  '3_Afterloader': E1Kategorie.AFTERLOADER,
  '6_Other': E1Kategorie.OTHER,
  // Budget
  Implant: E1Kategorie.IMPLANT,
  Ophthalmo: E1Kategorie.OPHTHALMO,
  Afterloader: E1Kategorie.AFTERLOADER,
  Other: E1Kategorie.OTHER,
  // Konsolidierung
  'Revenue Implants': E1Kategorie.IMPLANT,
  'Revenue Ophthalmo': E1Kategorie.OPHTHALMO,
  'Revenue Afterloader': E1Kategorie.AFTERLOADER,
  'Revenue Other': E1Kategorie.OTHER,
};

// ─────────────── PRODUKTGRUPPE E2 (kanonisch = CSV-Schreibweise; alle 17 realen Werte) ───────────────
export interface E2Definition {
  name: string;
  e1: E1Kategorie;
  synonyme: readonly string[];
  istGenerisch?: boolean; // "Other": E1 folgt KTREB1, nicht E2-Stamm
}

export const E2_TABLE: readonly E2Definition[] = [
  { name: 'Stranded Seeds S06/S17', e1: E1Kategorie.IMPLANT, synonyme: ['Stranded Seeds S06/S17+'] },
  { name: 'Loose Seeds S06/S17', e1: E1Kategorie.IMPLANT, synonyme: ['Loose Seeds S06/S17+'] },
  { name: 'LDR Trading Goods', e1: E1Kategorie.IMPLANT, synonyme: [] },
  { name: 'LDR Mick Products', e1: E1Kategorie.IMPLANT, synonyme: [] },
  { name: 'Therapy Accessories Mick Products', e1: E1Kategorie.OTHER, synonyme: [] },
  { name: 'Ophthalmo Trading Goods', e1: E1Kategorie.OPHTHALMO, synonyme: [] },
  { name: 'I-125 Ocular Seeds', e1: E1Kategorie.OPHTHALMO, synonyme: [] },
  { name: 'Ru-106 Applicators', e1: E1Kategorie.OPHTHALMO, synonyme: [] },
  { name: 'HDR Others', e1: E1Kategorie.AFTERLOADER, synonyme: ['HDR Others/Service'] },
  { name: 'HDR Service', e1: E1Kategorie.AFTERLOADER, synonyme: [] },
  { name: 'Exchange Source Co-60', e1: E1Kategorie.AFTERLOADER, synonyme: ['Exchange Source Co-60/Ir-192'] },
  { name: 'Exchange Source Ir-192', e1: E1Kategorie.AFTERLOADER, synonyme: [] },
  { name: 'Applicators & Equipment', e1: E1Kategorie.AFTERLOADER, synonyme: [] },
  { name: 'Applicators & Equipment Mick', e1: E1Kategorie.AFTERLOADER, synonyme: [] }, // A4
  { name: 'TP-Software', e1: E1Kategorie.AFTERLOADER, synonyme: [] },
  { name: 'Other', e1: E1Kategorie.OTHER, synonyme: [], istGenerisch: true },
];

// Platzhalter-/Sonderwerte
export const E2_ERHOEHUNG_PLATZHALTER = 'Erhöhung Platzhalter';
export const E2_UNBEKANNT_PRAEFIX = 'Unbekannt';
export const REGIONSRESERVE = '__REGIONSRESERVE__'; // Sentinel für Budget-Land "(Leer)"

// ─────────────── LAND (Budget-Klartext-Sonderfälle, lowercase-Key → ISO) ───────────────
export const LAND_NAME_TO_ISO_SPECIAL: Readonly<Record<string, string>> = {
  czech: 'CZ',
  'korea, south': 'KR',
  'united states': 'US',
  'united kingdom': 'GB',
};

// ─────────────── MONAT (deutscher Klartext → Zahl) ───────────────
export const MONAT_DE_TO_NUM: Readonly<Record<string, number>> = {
  Januar: 1,
  Februar: 2,
  März: 3,
  April: 4,
  Mai: 5,
  Juni: 6,
  Juli: 7,
  August: 8,
  September: 9,
  Oktober: 10,
  November: 11,
  Dezember: 12,
};

// ─────────────── EINSTELLUNGEN (Keys + Defaults) ───────────────
export const EINSTELLUNG_KEYS = {
  SCHWELLWERT_PROZENT: 'SCHWELLWERT_PROZENT',
  MONATS_SCHWELLWERT_PROZENT: 'MONATS_SCHWELLWERT_PROZENT', // Pflichtkommentar-Grenze je Einzelmonat (Forecast vs. Budget)
  DEADLINE_TAG: 'DEADLINE_TAG',
  AGM_CROSS_SICHT: 'AGM_CROSS_SICHT',
  BERICHTSWAEHRUNGSEINHEIT: 'BERICHTSWAEHRUNGSEINHEIT',
  SAMMEL_KOSTENSTELLEN: 'SAMMEL_KOSTENSTELLEN',
  POSTINGTYPE_WHITELIST: 'POSTINGTYPE_WHITELIST',
  IST_QUELLE: 'IST_QUELLE', // SALES_FLASH (verifiziertes Controlling-Ist) | GL (External Revenue)
  ABGLEICH_TOLERANZ_PROZENT: 'ABGLEICH_TOLERANZ_PROZENT', // Toleranzband GL<->Sales-Flash
  REPORT_DEADLINE_TAG: 'REPORT_DEADLINE_TAG', // Abgabefrist Monatsbericht: Tag im Folgemonat
  AUDIO_AUFBEWAHRUNG: 'AUDIO_AUFBEWAHRUNG', // Voice-Diktat: SOFORT_LOESCHEN | TAGE_30 | BEHALTEN
  CONTROLLING_EMAILS: 'CONTROLLING_EMAILS', // Komma-Liste: Empfänger für Forecast-Anpassungsmeldungen (Controlling)
} as const;

export const EINSTELLUNG_DEFAULTS: Readonly<Record<string, string>> = {
  [EINSTELLUNG_KEYS.SCHWELLWERT_PROZENT]: '10',
  [EINSTELLUNG_KEYS.MONATS_SCHWELLWERT_PROZENT]: '5',
  [EINSTELLUNG_KEYS.DEADLINE_TAG]: '10',
  [EINSTELLUNG_KEYS.AGM_CROSS_SICHT]: 'false',
  [EINSTELLUNG_KEYS.BERICHTSWAEHRUNGSEINHEIT]: 'kEUR',
  [EINSTELLUNG_KEYS.SAMMEL_KOSTENSTELLEN]: SAMMEL_KOSTENSTELLEN.join(','),
  [EINSTELLUNG_KEYS.POSTINGTYPE_WHITELIST]: '', // leer = alle Typen
  [EINSTELLUNG_KEYS.IST_QUELLE]: 'SALES_FLASH',
  [EINSTELLUNG_KEYS.ABGLEICH_TOLERANZ_PROZENT]: '2',
  [EINSTELLUNG_KEYS.REPORT_DEADLINE_TAG]: '10',
  [EINSTELLUNG_KEYS.AUDIO_AUFBEWAHRUNG]: 'SOFORT_LOESCHEN',
  [EINSTELLUNG_KEYS.CONTROLLING_EMAILS]: '', // leer = nur BU-Leitung wird benachrichtigt
};

// Erwartete Abnahme-Sollwerte des Ist-Erstimports (Ground-Truth, §16)
export const IST_ABNAHME = {
  zeilenGesamt: 10043,
  summeGesamtEur: 45146604.02,
  summenJeRegion: {
    AGC: 11894547.76,
    CS: 14814449.89,
    EMA: 5282614.48,
    EP: 7982685.58,
    WIA: 5146465.91,
    ZENTRAL: 25840.4,
  } as Readonly<Record<string, number>>,
} as const;
