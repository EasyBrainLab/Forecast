import { createHash } from 'crypto';
import ExcelJS from 'exceljs';

// Spalten (1-basiert): A(1) Label, D(4) IST (YTD), E(5) PY bzw. BUD (je Block).
const COL_LABEL = 1;
const COL_IST = 4;
const COL_VGL = 5;

/** Ziel-Positionen der P&L-Bruecke, in Anzeige-Reihenfolge. `match` = exaktes Label in Spalte A (Ausnahme: Financial result per Praefix). */
export const GUV_POSITIONEN: { key: string; label: string; match: string; ebene: number; praefix?: boolean }[] = [
  { key: 'REVENUE', label: '(A) Revenue', match: '(a) revenue', ebene: 0 },
  { key: 'COGS', label: '(B) Cost of Goods Sold', match: '(b) cost of goods sold', ebene: 1 },
  { key: 'GROSS_MARGIN', label: 'Gross Margin', match: 'gross margin', ebene: 0 },
  { key: 'ADMINISTRATION', label: '(C) Administration costs', match: '(c) administration costs', ebene: 1 },
  { key: 'DISTRIBUTION', label: '(D) Distribution costs', match: '(d) distribution costs', ebene: 1 },
  { key: 'RND', label: '(F) Research and Development', match: '(f) research and development', ebene: 1 },
  { key: 'OTHER_EXPENSE', label: '(H1) Other Expense', match: '(h1) other expense', ebene: 1 },
  { key: 'OTHER_INCOME', label: '(H2) Other Income', match: '(h2) other income', ebene: 1 },
  { key: 'OPERATING_RESULT', label: 'Operating result', match: 'operating result', ebene: 0 },
  { key: 'FINANCIAL_RESULT', label: '(I) Financial result', match: '(i) financial result', ebene: 1, praefix: true },
  { key: 'EBIT', label: 'EBIT', match: 'ebit', ebene: 0 },
  { key: 'TAX', label: '(K) Tax', match: '(k) tax', ebene: 1 },
  { key: 'EBIT_ADJ', label: 'EBIT Adj.', match: 'ebit adj.', ebene: 0 },
];

export interface GuvPositionRoh {
  key: string;
  label: string;
  ebene: number;
  ist: number; // kEUR
  py: number;
  bud: number;
}

export interface GuvParseErgebnis {
  positionen: GuvPositionRoh[];
  fehlend: string[];
}

/** Liest die zweiblöckige Controlling-GuV (IST vs PY / IST vs BUD, YTD) in eine Positionsliste. */
export class GuvExcelAdapter {
  constructor(
    private readonly buffer: Buffer,
    private readonly dateiname: string,
  ) {}

  meta(): { dateiname: string; hash: string } {
    return { dateiname: this.dateiname, hash: createHash('sha256').update(this.buffer).digest('hex') };
  }

  async lese(): Promise<GuvParseErgebnis> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(this.buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('Die GuV-Datei enthält kein Tabellenblatt.');

    const text = (r: number, c: number): string => {
      let x: unknown = ws.getCell(r, c).value;
      if (x && typeof x === 'object') x = (x as { result?: unknown; text?: unknown }).result ?? (x as { text?: unknown }).text ?? '';
      return String(x ?? '').replace(/\n/g, ' ').trim();
    };
    const num = (r: number, c: number): number => {
      let x: unknown = ws.getCell(r, c).value;
      if (x && typeof x === 'object') x = (x as { result?: unknown }).result ?? null;
      const n = Number(x);
      return Number.isFinite(n) ? n : 0;
    };
    const norm = (s: string): string => s.toLowerCase().trim();

    // Block-2-Start = Zeile, in der die Vergleichsspalte (E) den Kopf „BUD" trägt.
    let budHeader = 0;
    for (let r = 1; r <= ws.rowCount; r++) {
      if (norm(text(r, COL_VGL)) === 'bud') {
        budHeader = r;
        break;
      }
    }
    const block1Ende = budHeader > 0 ? budHeader : ws.rowCount + 1;

    const findeZeile = (von: number, bis: number, pos: (typeof GUV_POSITIONEN)[number]): number => {
      for (let r = von; r < bis; r++) {
        const lab = norm(text(r, COL_LABEL));
        if (!lab) continue;
        if (pos.praefix ? lab.startsWith(pos.match) : lab === pos.match) return r;
      }
      return 0;
    };

    const positionen: GuvPositionRoh[] = [];
    const fehlend: string[] = [];
    for (const pos of GUV_POSITIONEN) {
      const r1 = findeZeile(1, block1Ende, pos); // IST + PY
      const r2 = budHeader > 0 ? findeZeile(budHeader, ws.rowCount + 1, pos) : 0; // BUD
      if (!r1) {
        fehlend.push(pos.label);
        continue;
      }
      positionen.push({ key: pos.key, label: pos.label, ebene: pos.ebene, ist: num(r1, COL_IST), py: num(r1, COL_VGL), bud: r2 ? num(r2, COL_VGL) : 0 });
    }
    return { positionen, fehlend };
  }
}
