import { createHash } from 'crypto';
import { parse } from 'csv-parse/sync';
import type { LiefermengeQuelleAdapter, LiefermengeQuelleMeta, RohLiefermengeZeile } from './liefermenge-quelle.adapter';

// Feste Spaltenpositionen (0-basiert). Positionaler Zugriff, weil der ERP-Export doppelte Spaltennamen
// enthält (SO_/SOL_DATAAREAID, SO_/SOL_DELIVERYADDRESSLOCATIONID) — eine Namens-Map wäre mehrdeutig.
const COL = {
  shippingDate: 1,
  auftragsnummer: 3,
  kunde: 5,
  dataAreaId: 6,
  itemNumber: 7,
  cat00: 8,
  cat01: 9,
  stueckzahl: 11,
  seedzahl: 12,
  kostenstelle: 14,
  kostentraeger: 15,
  lineAmount: 16,
  orderedQty: 18,
  countryCode: 21,
} as const;

/** CSV-Adapter für den SOL-Export: BOM, Komma-Separator, gequotete Felder mit eingebetteten Kommas, englisches Zahlformat. */
export class CsvLiefermengeAdapter implements LiefermengeQuelleAdapter {
  constructor(
    private readonly buffer: Buffer,
    private readonly dateiname: string,
  ) {}

  meta(): LiefermengeQuelleMeta {
    return { dateiname: this.dateiname, hash: createHash('sha256').update(this.buffer).digest('hex') };
  }

  async lese(): Promise<RohLiefermengeZeile[]> {
    const rows = parse(this.buffer, {
      bom: true,
      delimiter: ',',
      columns: false,
      skip_empty_lines: true,
      relax_column_count: false,
      trim: false,
    }) as string[][];

    const cell = (r: string[], i: number): string => (r[i] ?? '').trim();
    return rows.slice(1).map((r, i) => ({
      zeilenNummer: i + 2, // +1 Header, +1 1-basiert
      shippingDate: cell(r, COL.shippingDate),
      auftragsnummer: cell(r, COL.auftragsnummer),
      kunde: cell(r, COL.kunde),
      itemNumber: cell(r, COL.itemNumber),
      cat00: cell(r, COL.cat00),
      cat01: cell(r, COL.cat01),
      stueckzahl: cell(r, COL.stueckzahl),
      seedzahl: cell(r, COL.seedzahl),
      orderedQty: cell(r, COL.orderedQty),
      lineAmount: cell(r, COL.lineAmount),
      kostenstelle: cell(r, COL.kostenstelle),
      kostentraeger: cell(r, COL.kostentraeger),
      dataAreaId: cell(r, COL.dataAreaId),
      countryCode: cell(r, COL.countryCode),
    }));
  }
}
