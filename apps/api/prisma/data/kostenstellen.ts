// Kostenstellen-Stammdaten. KST-Nummer ist die führende Region-Brücke (§4.1).
// company ist informativ (häufigste je KST); pro Ist-Buchung kommt sie aus DATAAREAID.
export interface KostenstelleSeed {
  nummer: string;
  bezeichnung: string;
  regionCode: string;
  istSammel: boolean;
  company: 'BBD' | 'BBE' | 'BBF' | 'BMW';
}

export const KOSTENSTELLEN: readonly KostenstelleSeed[] = [
  { nummer: '252', bezeichnung: 'Vertrieb EP (ehemals AES)', regionCode: 'EP', istSammel: false, company: 'BBD' },
  { nummer: '253', bezeichnung: 'Vertrieb WIA', regionCode: 'WIA', istSammel: false, company: 'BBD' },
  { nummer: '254', bezeichnung: 'Vertrieb EMA', regionCode: 'EMA', istSammel: false, company: 'BBD' },
  { nummer: '255', bezeichnung: 'Vertrieb AGC', regionCode: 'AGC', istSammel: false, company: 'BBE' },
  { nummer: '256', bezeichnung: 'Vertrieb Berlin (Radiotherapie)', regionCode: 'CS', istSammel: false, company: 'BBD' },
  { nummer: '257', bezeichnung: 'Vertrieb Berlin (Radiotherapie)', regionCode: 'CS', istSammel: false, company: 'BBD' },
  // Sammel-/Zentral-Kostenstellen (kein Forecast)
  { nummer: '110', bezeichnung: 'Zentralbereich 110', regionCode: 'ZENTRAL', istSammel: true, company: 'BBD' },
  { nummer: '150', bezeichnung: 'Zentralbereich 150', regionCode: 'ZENTRAL', istSammel: true, company: 'BBD' },
  { nummer: '200', bezeichnung: 'Zentralbereich 200', regionCode: 'ZENTRAL', istSammel: true, company: 'BBD' },
  { nummer: '220', bezeichnung: 'Zentralbereich 220', regionCode: 'ZENTRAL', istSammel: true, company: 'BBD' },
  { nummer: '262', bezeichnung: 'Vertrieb KMA (Stammdatenpflege)', regionCode: 'ZENTRAL', istSammel: true, company: 'BBD' },
  { nummer: '264', bezeichnung: 'Vertrieb WOMED (Stammdatenpflege)', regionCode: 'ZENTRAL', istSammel: true, company: 'BBD' },
  { nummer: '270', bezeichnung: 'Service / Zentralbereich 270', regionCode: 'ZENTRAL', istSammel: true, company: 'BBD' },
  { nummer: '280', bezeichnung: 'Zentralbereich 280', regionCode: 'ZENTRAL', istSammel: true, company: 'BBD' },
  { nummer: '500', bezeichnung: 'Zentralbereich 500', regionCode: 'ZENTRAL', istSammel: true, company: 'BBD' },
  { nummer: '690', bezeichnung: 'Zentralbereich 690', regionCode: 'ZENTRAL', istSammel: true, company: 'BBD' },
];

export interface RegionSeed {
  code: string;
  bezeichnung: string;
  forecastRelevant: boolean;
  synonyme: string[];
}

export const REGIONEN: readonly RegionSeed[] = [
  { code: 'EP', bezeichnung: 'Europa Süd (AES)', forecastRelevant: true, synonyme: ['AES'] },
  { code: 'WIA', bezeichnung: 'West/International (WIA)', forecastRelevant: true, synonyme: [] },
  { code: 'EMA', bezeichnung: 'EMEA (EMA)', forecastRelevant: true, synonyme: [] },
  { code: 'AGC', bezeichnung: 'AGC', forecastRelevant: true, synonyme: [] },
  { code: 'CS', bezeichnung: 'Customer Service / Berlin (Radiotherapie)', forecastRelevant: true, synonyme: ['Radiotherapie'] },
  { code: 'ZENTRAL', bezeichnung: 'Zentral/Sonstige', forecastRelevant: false, synonyme: [] },
];
