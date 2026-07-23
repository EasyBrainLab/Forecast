import { createHash } from 'crypto';
import ExcelJS from 'exceljs';

// Spaltenlayout der Controlling-P&L-Excel (1-basiert): Actual Jan–Dez = 4..15, Budget Jan–Dez = 17..28.
const ACTUAL_START = 4;
const BUDGET_START = 17;

export interface PlZeile {
  kennzahlTyp: 'REVENUE' | 'COGS' | 'OTHER_COSTS';
  actual: (number | null)[]; // 12 Monate (kEUR, Kosten negativ)
  budget: (number | null)[];
  excelZeile: number;
}

export interface PlParseErgebnis {
  sheetName: string;
  zeilen: PlZeile[]; // REVENUE + COGS + OTHER_COSTS
  /** nur zur Plausibilitätskontrolle (nicht importiert) */
  operatingResultActual: (number | null)[];
}

/** Liest COGS + Other Costs (Actual + Budget je Monat) aus der Controlling-P&L-Excel. Zeilen werden robust per Label in Spalte B gefunden. */
export class PlKostenExcelAdapter {
  constructor(
    private readonly buffer: Buffer,
    private readonly dateiname: string,
  ) {}

  meta(): { dateiname: string; hash: string } {
    return { dateiname: this.dateiname, hash: createHash('sha256').update(this.buffer).digest('hex') };
  }

  async lese(): Promise<PlParseErgebnis> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(this.buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Therapy') ?? wb.worksheets[0];
    if (!ws) throw new Error('Die Excel-Datei enthält kein Tabellenblatt.');

    const monate = (row: ExcelJS.Row, start: number): (number | null)[] => {
      const out: (number | null)[] = [];
      for (let c = start; c < start + 12; c++) out.push(this.num(row.getCell(c).value));
      return out;
    };

    const zeilen: PlZeile[] = [];
    let operatingResultActual: (number | null)[] = [];

    ws.eachRow((row, rowNumber) => {
      const label = this.text(row.getCell(2).value).toLowerCase();
      if (!label) return;
      if (label === 'revenues') zeilen.push({ kennzahlTyp: 'REVENUE', actual: monate(row, ACTUAL_START), budget: monate(row, BUDGET_START), excelZeile: rowNumber });
      else if (label === 'cogs') zeilen.push({ kennzahlTyp: 'COGS', actual: monate(row, ACTUAL_START), budget: monate(row, BUDGET_START), excelZeile: rowNumber });
      else if (label === 'other costs') zeilen.push({ kennzahlTyp: 'OTHER_COSTS', actual: monate(row, ACTUAL_START), budget: monate(row, BUDGET_START), excelZeile: rowNumber });
      else if (label === 'operating result') operatingResultActual = monate(row, ACTUAL_START);
    });

    return { sheetName: ws.name, zeilen, operatingResultActual };
  }

  private num(v: ExcelJS.CellValue): number | null {
    let x: unknown = v;
    if (x && typeof x === 'object') {
      if ('result' in x) x = (x as { result?: unknown }).result ?? null;
      else if ('text' in x) x = (x as { text?: unknown }).text ?? null;
      else x = null;
    }
    if (x === null || x === undefined || x === '') return null;
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }

  private text(v: ExcelJS.CellValue): string {
    let x: unknown = v;
    if (x && typeof x === 'object') x = (x as { result?: unknown; text?: unknown }).result ?? (x as { text?: unknown }).text ?? '';
    return String(x ?? '').trim();
  }
}
