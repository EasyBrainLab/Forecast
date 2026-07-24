import * as crypto from 'crypto';
import ExcelJS from 'exceljs';
import { BUDGET_GRUPPE_TO_REGION, E1_LOOKUP, KST_TO_REGION, MONAT_DE_TO_NUM } from '@forecast/shared';

export interface RohSalesFlashZeile {
  jahr: number;
  monat: number;
  dataAreaId: string;
  debitornr: string;
  kundenname: string;
  articleNr: string | null;
  articleName: string | null;
  kostenstelle: string | null;
  kostentraeger: string | null;
  e1Kategorie: string | null;
  e2Name: string | null;
  regionCode: string | null;
  landIso: string | null;
  rechnungsnr: string | null;
  projektnummer: string | null;
  betragEur: number;
}

const txt = (c: ExcelJS.Cell | undefined): string => {
  if (!c) return '';
  let v: unknown = c.value;
  if (v && typeof v === 'object') v = (v as { result?: unknown; text?: unknown }).result ?? (v as { text?: unknown }).text ?? '';
  return v == null ? '' : String(v).trim();
};
const zahl = (c: ExcelJS.Cell | undefined): number => {
  if (!c) return 0;
  let v: unknown = c.value;
  if (v && typeof v === 'object') v = (v as { result?: unknown }).result ?? 0;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Adapter für „Therapy Sales Flash Daten JJJJ+JJJJ.xlsx". Ein Blatt je Jahr („DATEN JJJJ.MM"),
 * je Zeile eine Umsatzbuchung. Spalten werden per Kopfzeile (Zeile 1) aufgelöst (robust gegen
 * Umsortierung). Region-Ableitung: KST-Nummer (Mapping-Wahrheit), sonst KST-Gruppe.
 */
export class SalesFlashUmsatzAdapter {
  private readonly hashWert: string;
  constructor(
    private readonly buffer: Buffer,
    private readonly dateiname: string,
  ) {
    this.hashWert = crypto.createHash('sha256').update(buffer).digest('hex');
  }

  meta(): { dateiname: string; hash: string } {
    return { dateiname: this.dateiname, hash: this.hashWert };
  }

  async lese(): Promise<RohSalesFlashZeile[]> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(this.buffer as unknown as ArrayBuffer);
    const out: RohSalesFlashZeile[] = [];

    for (const ws of wb.worksheets) {
      // Kopfzeile → Spaltenindex (erste Fundstelle je Name).
      const spalte = new Map<string, number>();
      for (let c = 1; c <= ws.columnCount; c++) {
        const h = txt(ws.getCell(1, c));
        if (h && !spalte.has(h)) spalte.set(h, c);
      }
      const idx = (name: string): number => spalte.get(name) ?? 0;
      const get = (r: number, name: string): string => (idx(name) ? txt(ws.getCell(r, idx(name))) : '');
      const getNum = (r: number, name: string): number => (idx(name) ? zahl(ws.getCell(r, idx(name))) : 0);
      if (!idx('Debitornr') || (!idx('Betrag') && !idx('ms_Amount'))) continue; // kein Datenblatt

      for (let r = 2; r <= ws.rowCount; r++) {
        const jahr = Number(get(r, 'Year')) || 0;
        const monat = MONAT_DE_TO_NUM[get(r, 'Month')] ?? MONAT_DE_TO_NUM[get(r, 'Monat')] ?? 0;
        const betragEur = idx('Betrag') ? getNum(r, 'Betrag') : getNum(r, 'ms_Amount');
        if (!jahr || !monat) continue; // echte Leer-/Summenzeile
        // Umsatz ohne Debitor (z. B. Frachten/Abgrenzungen) unter Platzhalter führen — Gesamtsumme bleibt = Controlling.
        const debitornr = get(r, 'Debitornr') || '(ohne)';

        const kostenstelle = get(r, 'CostCenter') || null;
        const kstGruppe = get(r, 'KST Gruppe');
        const kstNum = kostenstelle ? Number(kostenstelle) : NaN;
        const regionCode = (Number.isFinite(kstNum) ? KST_TO_REGION[kstNum] : undefined) ?? BUDGET_GRUPPE_TO_REGION[kstGruppe] ?? (kstGruppe || null);
        const e1Roh = get(r, 'Ebene 1');
        const e1Kategorie = E1_LOOKUP[e1Roh] ?? (e1Roh || null);

        out.push({
          jahr,
          monat,
          dataAreaId: get(r, 'Company') || 'BBD',
          debitornr,
          kundenname: get(r, 'Kundenname') || get(r, 'Customer') || get(r, 'Kunde') || (debitornr === '(ohne)' ? '(ohne Debitor)' : debitornr),
          articleNr: get(r, 'Article') || null,
          articleName: get(r, 'Artikel') || null,
          kostenstelle,
          kostentraeger: get(r, 'CostObject') || null,
          e1Kategorie,
          e2Name: get(r, 'Ebene 2') || null,
          regionCode,
          landIso: get(r, 'CustomerShipped') || get(r, 'Kundensitz') || null,
          rechnungsnr: get(r, 'ms_InvNumber') || null,
          projektnummer: get(r, 'Projektnummer') || null,
          betragEur: Math.round(betragEur * 100) / 100,
        });
      }
    }
    return out;
  }
}
