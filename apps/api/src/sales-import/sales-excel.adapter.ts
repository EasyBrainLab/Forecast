import { createHash } from 'crypto';
import { Readable } from 'stream';
import ExcelJS from 'exceljs';

export type Zellwert = string | number | boolean | Date | null;
/** Eine Zeile als Zugriff über den Spaltenkopf (Header-Name → Wert). */
export type NamedRow = { get(header: string): Zellwert; all(): Record<string, Zellwert>; zeilenNummer: number };

/** Normalisiert eine ExcelJS-Zelle auf einen einfachen Wert (Formel-Result, RichText, Hyperlink berücksichtigt). */
export function cellVal(v: ExcelJS.CellValue): Zellwert {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v && v.result !== undefined) return (v.result as Zellwert) ?? null;
    if ('text' in v) return (v as { text: string }).text;
    if ('hyperlink' in v) return (v as { text?: string }).text ?? null;
  }
  return null;
}

export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Liest ein Excel-Sheet komplett in den Speicher (für kleinere Dateien: Kundenstamm, Rechnungsköpfe).
 * Gibt einen Iterator über NamedRow zurück; die erste Zeile ist der Header.
 */
export async function ladeNamedRows(buffer: Buffer): Promise<NamedRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const header = (ws.getRow(1).values as ExcelJS.CellValue[]).map((v) => (cellVal(v) ?? '').toString().trim());
  const idx = new Map<string, number>();
  header.forEach((h, i) => { if (h) idx.set(h, i); });
  const rows: NamedRow[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const vals = row.values as ExcelJS.CellValue[];
    rows.push({
      zeilenNummer: rowNumber,
      get: (h: string) => { const i = idx.get(h); return i === undefined ? null : cellVal(vals[i]); },
      all: () => { const o: Record<string, Zellwert> = {}; for (const [h, i] of idx) o[h] = cellVal(vals[i]); return o; },
    });
  });
  return rows;
}

/**
 * Streamt ein Excel-Sheet zeilenweise (für die große Positions-Datei, ~130k Zeilen) und ruft `onRow` je Zeile auf.
 * Bounded memory: es wird nie das ganze Workbook gehalten. Gibt die Gesamtzahl der Datenzeilen zurück.
 */
export async function streameNamedRows(buffer: Buffer, onRow: (row: NamedRow) => Promise<void> | void): Promise<number> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), {
    entries: 'emit',
    sharedStrings: 'cache',
    styles: 'cache', // nötig, damit Datumszellen als Date (statt als Serien-Nummer) ankommen
    worksheets: 'emit',
  });
  let idx: Map<string, number> | null = null;
  let count = 0;
  for await (const worksheet of reader) {
    for await (const row of worksheet as unknown as AsyncIterable<ExcelJS.Row>) {
      const vals = row.values as ExcelJS.CellValue[];
      if (row.number === 1) {
        idx = new Map<string, number>();
        vals.forEach((v, i) => { const h = (cellVal(v) ?? '').toString().trim(); if (h) idx!.set(h, i); });
        continue;
      }
      if (!idx) continue;
      const map = idx;
      count++;
      await onRow({
        zeilenNummer: row.number,
        get: (h: string) => { const i = map.get(h); return i === undefined ? null : cellVal(vals[i]); },
        all: () => { const o: Record<string, Zellwert> = {}; for (const [h, i] of map) o[h] = cellVal(vals[i]); return o; },
      });
    }
  }
  return count;
}

/** Datum robust lesen: Date-Objekt, ISO-String oder Excel-Serien-Nummer (Streaming-Fallback). null bei Unlesbarkeit. */
export function leseDatum(v: Zellwert): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // Excel-Serien-Nummer (Tage seit 1899-12-30; 25569 = Tage bis 1970-01-01). Plausibler Bereich ~ 1990–2100.
  if (typeof v === 'number' && v > 30000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Zahl robust aus einer Zelle (number oder String mit Punkt-Dezimal aus D365) lesen; null bei leer. */
export function leseZahl(v: Zellwert): number | null {
  if (v === null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/\s/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** String robust aus einer Zelle; null bei leer. */
export function leseText(v: Zellwert): string | null {
  if (v === null) return null;
  const s = (v instanceof Date ? v.toISOString() : String(v)).trim();
  return s || null;
}
