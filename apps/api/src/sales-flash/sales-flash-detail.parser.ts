import ExcelJS from 'exceljs';

export interface DetailRohZeile {
  produktgruppeRoh: string;
  landRoh: string;
  /** Actual je Kalendermonat, Index 0 = Januar … 11 = Dezember. null = kein Wert. */
  actualProMonat: (number | null)[];
}

export interface DetailParseErgebnis {
  sheetRegion: string; // Region laut Datei (Sheet-Name / Kopfzelle), nur zur Kontrolle
  zeilen: DetailRohZeile[];
}

const zahl = (v: unknown): number | null => {
  let x: unknown = v;
  if (x && typeof x === 'object') x = (x as { result?: unknown }).result ?? null;
  if (x === null || x === undefined || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

const text = (v: unknown): string => {
  let x: unknown = v;
  if (x && typeof x === 'object') x = (x as { result?: unknown; text?: unknown }).result ?? (x as { text?: unknown }).text ?? '';
  return String(x ?? '').trim();
};

/**
 * Liest eine Region-Forecast-Excel (Controlling) und extrahiert je Produktgruppe × Land die
 * Actual-Monatswerte (Spalten 4–15 = Jan..Dez, volle EUR). Spalte 2 = Produktgruppe, Spalte 3 = Land.
 * Kopfzeilen (1–4) und die Summenzeile (ohne Produktgruppe/Land) werden übersprungen.
 */
export async function parseRegionExcel(buffer: Buffer): Promise<DetailParseErgebnis> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Die Excel-Datei enthält kein Tabellenblatt.');

  const zeilen: DetailRohZeile[] = [];
  for (let r = 5; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const produktgruppeRoh = text(row.getCell(2).value);
    const landRoh = text(row.getCell(3).value);
    if (!produktgruppeRoh && !landRoh) continue; // Summen-/Leerzeile
    const actualProMonat: (number | null)[] = [];
    for (let m = 0; m < 12; m++) actualProMonat.push(zahl(row.getCell(4 + m).value));
    // Zeilen ohne jeglichen Actual-Wert überspringen (reine Budget-/Forecast-Zeilen ohne Ist).
    if (actualProMonat.every((v) => v === null || v === 0)) continue;
    zeilen.push({ produktgruppeRoh, landRoh, actualProMonat });
  }

  return { sheetRegion: text(ws.getRow(4).getCell(3).value) || ws.name, zeilen };
}
