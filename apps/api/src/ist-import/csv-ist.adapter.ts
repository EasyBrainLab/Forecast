import { createHash } from 'crypto';
import { parse } from 'csv-parse/sync';
import type { IstQuelleAdapter, IstQuelleMeta, RohIstZeile } from './ist-quelle.adapter';

/** CSV-Adapter (GL-Abriss "External Revenue BU Therapie"): BOM, Komma-Separator, deutsches Dezimal. */
export class CsvIstAdapter implements IstQuelleAdapter {
  constructor(
    private readonly buffer: Buffer,
    private readonly dateiname: string,
  ) {}

  meta(): IstQuelleMeta {
    return { dateiname: this.dateiname, hash: createHash('sha256').update(this.buffer).digest('hex') };
  }

  async lese(): Promise<RohIstZeile[]> {
    const records = parse(this.buffer, {
      bom: true,
      delimiter: ',',
      columns: true,
      skip_empty_lines: true,
      relax_column_count: false,
      trim: false,
    }) as Record<string, string>[];

    return records.map((r, i) => ({
      zeilenNummer: i + 2, // +1 Header, +1 1-basiert
      dataareaid: r['DATAAREAID'] ?? '',
      kostenstelle: r['Kostenstelle'] ?? '',
      kostenstellenOwner: r['KostenstellenOwner'] ?? '',
      ktreb1: r['KTREB1'] ?? '',
      ktreb2: r['KTREB2'] ?? '',
      sachkonto: r['Sachkonto'] ?? '',
      jahr: r['Jahr'] ?? '',
      monat: r['Monat'] ?? '',
      tag: r['Tag'] ?? '',
      value: r['Value'] ?? '',
      accountingAmount: r['Summe von ACCOUNTINGCURRENCYAMOUNT'] ?? '',
      recid: r['RECID'] ?? '',
      kostentraeger: r['Kostentraeger'] ?? '',
      postingtype: r['POSTINGTYPE'] ?? '',
      country: r['Country'] ?? '',
    }));
  }
}
