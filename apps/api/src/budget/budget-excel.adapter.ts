import { createHash } from 'crypto';
import ExcelJS from 'exceljs';

export interface BudgetRohZeile {
  zeilenNummer: number;
  cells: (string | number | null)[]; // 0-basiert, Index 0..67
}

/** Liest die Budget-Wide-Excel (1 Sheet, 68 Spalten) in eine Zellmatrix. */
export class BudgetExcelAdapter {
  constructor(
    private readonly buffer: Buffer,
    private readonly dateiname: string,
  ) {}

  meta(): { dateiname: string; hash: string } {
    return { dateiname: this.dateiname, hash: createHash('sha256').update(this.buffer).digest('hex') };
  }

  async lese(): Promise<BudgetRohZeile[]> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(this.buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const out: BudgetRohZeile[] = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Header
      const cells: (string | number | null)[] = [];
      for (let c = 1; c <= 68; c++) {
        cells.push(this.cellVal(row.getCell(c).value));
      }
      // Leerzeilen (ohne die ersten 7 Schlüsselspalten) überspringen
      if (cells.slice(0, 7).every((v) => v === null || v === '')) return;
      out.push({ zeilenNummer: rowNumber, cells });
    });
    return out;
  }

  private cellVal(v: ExcelJS.CellValue): string | number | null {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number' || typeof v === 'string') return v;
    if (typeof v === 'object') {
      if ('result' in v && v.result !== undefined) return (v.result as string | number | null) ?? null;
      if ('text' in v) return (v as { text: string }).text;
    }
    return null;
  }
}
