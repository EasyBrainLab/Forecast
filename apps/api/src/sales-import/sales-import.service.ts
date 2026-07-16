import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, QuarantaeneGrund } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  ladeNamedRows,
  leseDatum,
  leseText,
  leseZahl,
  sha256,
  streameNamedRows,
  type NamedRow,
} from './sales-excel.adapter';

const CHUNK = 2000;

export interface SalesImportBericht {
  typ: 'KUNDENSTAMM' | 'RECHNUNG' | 'RECHNUNGSPOSITION';
  zeilenGesamt: number;
  zeilenNeu: number;
  zeilenAktualisiert: number;
  zeilenUebersprungen: number;
  zeilenQuarantaene: number;
  detail: Record<string, unknown>;
}

type Aktor = { id: string; email: string };

@Injectable()
export class SalesImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async batchAnlegen(typ: string, dateiname: string, hash: string, zeilenGesamt: number, aktor: Aktor) {
    return this.prisma.importBatch.create({
      data: { typ, dateiname, hash, ausgeloestVonId: aktor.id, status: 'HOCHGELADEN', zeilenGesamt },
    });
  }

  private async batchAbschliessen(batchId: string, bericht: SalesImportBericht, aktor: Aktor): Promise<void> {
    await this.prisma.importBatch.update({
      where: { id: batchId },
      data: {
        status: 'ABGESCHLOSSEN',
        abgeschlossenAm: new Date(),
        zeilenGesamt: bericht.zeilenGesamt,
        zeilenNeu: bericht.zeilenNeu,
        zeilenAktualisiert: bericht.zeilenAktualisiert,
        zeilenUebersprungen: bericht.zeilenUebersprungen,
        zeilenQuarantaene: bericht.zeilenQuarantaene,
        validierungsbericht: bericht as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.write({
      entitaet: 'ImportBatch',
      entitaetId: batchId,
      aktion: 'IMPORT',
      userId: aktor.id,
      userEmail: aktor.email,
      metadaten: { typ: bericht.typ, neu: bericht.zeilenNeu, aktualisiert: bericht.zeilenAktualisiert, quarantaene: bericht.zeilenQuarantaene },
    });
  }

  private q(batchId: string, row: NamedRow, grund: QuarantaeneGrund, detail?: string, recid?: string | null): Prisma.ImportQuarantaeneCreateManyInput {
    return {
      importBatchId: batchId,
      zeilenNummer: row.zeilenNummer,
      recid: recid ?? null,
      rohdaten: row.all() as unknown as Prisma.InputJsonValue,
      grund,
      detail: detail ?? null,
    };
  }

  // ─────────────── KUNDENSTAMM (CustCustomerV3) ───────────────
  async importiereKundenstamm(buffer: Buffer, dateiname: string, aktor: Aktor): Promise<{ batchId: string; bericht: SalesImportBericht }> {
    const rows = await ladeNamedRows(buffer);
    const batch = await this.batchAnlegen('KUNDENSTAMM', dateiname, sha256(buffer), rows.length, aktor);
    const existing = new Set(
      (await this.prisma.kundenstamm.findMany({ select: { dataAreaId: true, kundennummer: true } })).map((k) => `${k.dataAreaId}|${k.kundennummer}`),
    );
    const inserts: Prisma.KundenstammCreateManyInput[] = [];
    const updates: { where: Prisma.KundenstammWhereUniqueInput; data: Prisma.KundenstammUpdateInput }[] = [];
    const quarantaene: Prisma.ImportQuarantaeneCreateManyInput[] = [];
    const seen = new Set<string>();
    const gruppen: Record<string, number> = {};
    let neu = 0, akt = 0, quar = 0;

    for (const row of rows) {
      const kundennummer = leseText(row.get('CUSTOMERACCOUNT'));
      const dataAreaId = leseText(row.get('DATAAREAID'));
      if (!kundennummer || !dataAreaId) { quarantaene.push(this.q(batch.id, row, 'SCHLUESSEL_LEER', 'CUSTOMERACCOUNT/DATAAREAID leer')); quar++; continue; }
      const key = `${dataAreaId}|${kundennummer}`;
      if (seen.has(key)) { quarantaene.push(this.q(batch.id, row, 'SCHLUESSEL_DUP_IN_DATEI', key)); quar++; continue; }
      seen.add(key);
      const daten = {
        kundennummer,
        dataAreaId,
        name: leseText(row.get('ORGANIZATIONNAME')) ?? kundennummer,
        kundengruppe: leseText(row.get('CUSTOMERGROUPID')),
        landIso: leseText(row.get('ADDRESSCOUNTRYREGIONISOCODE')),
        stadt: leseText(row.get('ADDRESSCITY')),
        plz: leseText(row.get('ADDRESSZIPCODE')),
        strasse: leseText(row.get('ADDRESSSTREET')),
        waehrung: leseText(row.get('SALESCURRENCYCODE')),
        typ: leseText(row.get('CUSTOMERTYPE')),
      };
      const grp = daten.kundengruppe ?? '—';
      gruppen[grp] = (gruppen[grp] ?? 0) + 1;
      const rohdaten = row.all() as unknown as Prisma.InputJsonValue;
      if (existing.has(key)) {
        const updData: Prisma.KundenstammUpdateInput = { ...daten, rohdaten };
        updates.push({ where: { dataAreaId_kundennummer: { dataAreaId, kundennummer } }, data: updData });
        akt++;
      } else {
        inserts.push({ ...daten, rohdaten, importBatchId: batch.id });
        neu++;
      }
    }

    for (let i = 0; i < inserts.length; i += CHUNK) await this.prisma.kundenstamm.createMany({ data: inserts.slice(i, i + CHUNK) });
    for (const u of updates) await this.prisma.kundenstamm.update({ where: u.where, data: u.data });
    if (quarantaene.length) await this.prisma.importQuarantaene.createMany({ data: quarantaene });

    const bericht: SalesImportBericht = {
      typ: 'KUNDENSTAMM', zeilenGesamt: rows.length, zeilenNeu: neu, zeilenAktualisiert: akt, zeilenUebersprungen: 0, zeilenQuarantaene: quar,
      detail: { gesellschaften: this.zaehleGesellschaften(rows, 'DATAAREAID'), gruppenTop: this.topN(gruppen, 12) },
    };
    await this.batchAbschliessen(batch.id, bericht, aktor);
    return { batchId: batch.id, bericht };
  }

  // ─────────────── RECHNUNGSKÖPFE (dboSalesInvoiceHeader) ───────────────
  async importiereRechnungen(buffer: Buffer, dateiname: string, aktor: Aktor): Promise<{ batchId: string; bericht: SalesImportBericht }> {
    const rows = await ladeNamedRows(buffer);
    const batch = await this.batchAnlegen('RECHNUNG', dateiname, sha256(buffer), rows.length, aktor);
    const existing = new Set((await this.prisma.verkaufsrechnung.findMany({ select: { recid: true } })).map((r) => r.recid));
    const inserts: Prisma.VerkaufsrechnungCreateManyInput[] = [];
    const quarantaene: Prisma.ImportQuarantaeneCreateManyInput[] = [];
    const seenRecid = new Set<string>();
    const seenKey = new Set<string>();
    const summeJeWaehrung: Record<string, number> = {};
    const kunden = new Set<string>();
    let neu = 0, skip = 0, quar = 0, gutschriften = 0;
    let minD: number | null = null, maxD: number | null = null;

    for (const row of rows) {
      const recid = leseText(row.get('RECID'));
      if (!recid) { quarantaene.push(this.q(batch.id, row, 'RECID_LEER')); quar++; continue; }
      if (seenRecid.has(recid)) { quarantaene.push(this.q(batch.id, row, 'RECID_DUP_IN_DATEI', recid, recid)); quar++; continue; }
      seenRecid.add(recid);
      const rechnungsnummer = leseText(row.get('INVOICENUMBER'));
      const dataAreaId = leseText(row.get('DATAAREAID'));
      const datum = leseDatum(row.get('INVOICEDATE_Date'));
      if (!rechnungsnummer || !dataAreaId) { quarantaene.push(this.q(batch.id, row, 'SCHLUESSEL_LEER', 'INVOICENUMBER/DATAAREAID leer', recid)); quar++; continue; }
      if (!datum) { quarantaene.push(this.q(batch.id, row, 'DATUM_UNGUELTIG', 'INVOICEDATE_Date', recid)); quar++; continue; }
      const kkey = `${dataAreaId}|${rechnungsnummer}`;
      if (seenKey.has(kkey)) { quarantaene.push(this.q(batch.id, row, 'SCHLUESSEL_DUP_IN_DATEI', kkey, recid)); quar++; continue; }
      seenKey.add(kkey);
      const kundennummer = leseText(row.get('INVOICECUSTOMERACCOUNTNUMBER')) ?? '';
      const waehrung = leseText(row.get('CURRENCYCODE')) ?? 'EUR';
      const betrag = leseZahl(row.get('TOTALINVOICEAMOUNT')) ?? 0;
      kunden.add(kundennummer);
      summeJeWaehrung[waehrung] = (summeJeWaehrung[waehrung] ?? 0) + betrag;
      if (betrag < 0) gutschriften++;
      const t = datum.getTime();
      minD = minD === null ? t : Math.min(minD, t);
      maxD = maxD === null ? t : Math.max(maxD, t);
      if (existing.has(recid)) { skip++; continue; }
      inserts.push({
        recid, rechnungsnummer, dataAreaId, kundennummer, rechnungsdatum: datum, waehrung,
        betragGesamt: betrag, landIso: leseText(row.get('INVOICEADDRESSCOUNTRYREGIONISOCODE')), stadt: leseText(row.get('INVOICEADDRESSCITY')),
        importBatchId: batch.id,
      });
      neu++;
    }

    for (let i = 0; i < inserts.length; i += CHUNK) await this.prisma.verkaufsrechnung.createMany({ data: inserts.slice(i, i + CHUNK) });
    if (quarantaene.length) await this.prisma.importQuarantaene.createMany({ data: quarantaene });

    const bericht: SalesImportBericht = {
      typ: 'RECHNUNG', zeilenGesamt: rows.length, zeilenNeu: neu, zeilenAktualisiert: 0, zeilenUebersprungen: skip, zeilenQuarantaene: quar,
      detail: {
        distinctKunden: kunden.size, gutschriften,
        summeJeWaehrung: this.runde(summeJeWaehrung),
        datumVon: minD ? new Date(minD).toISOString().slice(0, 10) : null,
        datumBis: maxD ? new Date(maxD).toISOString().slice(0, 10) : null,
      },
    };
    await this.batchAbschliessen(batch.id, bericht, aktor);
    return { batchId: batch.id, bericht };
  }

  // ─────────────── RECHNUNGSPOSITIONEN (dboSalesInvoiceLines, ~130k) ───────────────
  async importierePositionen(buffer: Buffer, dateiname: string, aktor: Aktor): Promise<{ batchId: string; bericht: SalesImportBericht }> {
    const kopfMap = new Map<string, { kundennummer: string }>(
      (await this.prisma.verkaufsrechnung.findMany({ select: { dataAreaId: true, rechnungsnummer: true, kundennummer: true } })).map((r) => [
        `${r.dataAreaId}|${r.rechnungsnummer}`,
        { kundennummer: r.kundennummer },
      ]),
    );
    if (kopfMap.size === 0) throw new BadRequestException('Bitte zuerst die Rechnungsköpfe importieren — es sind keine Rechnungen vorhanden.');
    const existing = new Set((await this.prisma.verkaufsrechnungsposition.findMany({ select: { recid: true } })).map((r) => r.recid));

    const batch = await this.batchAnlegen('RECHNUNGSPOSITION', dateiname, sha256(buffer), 0, aktor);
    const seenRecid = new Set<string>();
    let puffer: Prisma.VerkaufsrechnungspositionCreateManyInput[] = [];
    const quarPuffer: Prisma.ImportQuarantaeneCreateManyInput[] = [];
    const produkte = new Set<string>();
    let gesamt = 0, neu = 0, skip = 0, quar = 0, gutschriften = 0, mengeNull = 0, ohneProdukt = 0;

    const flush = async () => { if (puffer.length) { await this.prisma.verkaufsrechnungsposition.createMany({ data: puffer }); puffer = []; } };
    const flushQuar = async () => { if (quarPuffer.length) { await this.prisma.importQuarantaene.createMany({ data: quarPuffer.splice(0, quarPuffer.length) }); } };

    gesamt = await streameNamedRows(buffer, async (row) => {
      const recid = leseText(row.get('RECID'));
      if (!recid) { quarPuffer.push(this.q(batch.id, row, 'RECID_LEER')); quar++; return; }
      if (seenRecid.has(recid)) { quarPuffer.push(this.q(batch.id, row, 'RECID_DUP_IN_DATEI', recid, recid)); quar++; return; }
      seenRecid.add(recid);
      const rechnungsnummer = leseText(row.get('INVOICENUMBER'));
      const dataAreaId = leseText(row.get('DATAAREAID'));
      const datum = leseDatum(row.get('INVOICEDATE_Date'));
      if (!rechnungsnummer || !dataAreaId) { quarPuffer.push(this.q(batch.id, row, 'SCHLUESSEL_LEER', 'INVOICENUMBER/DATAAREAID leer', recid)); quar++; return; }
      if (!datum) { quarPuffer.push(this.q(batch.id, row, 'DATUM_UNGUELTIG', 'INVOICEDATE_Date', recid)); quar++; return; }
      const kopf = kopfMap.get(`${dataAreaId}|${rechnungsnummer}`);
      if (!kopf) { quarPuffer.push(this.q(batch.id, row, 'RECHNUNG_OHNE_KOPF', `${dataAreaId}|${rechnungsnummer}`, recid)); quar++; return; }
      if (existing.has(recid)) { skip++; return; }

      const produktnummer = leseText(row.get('PRODUCTNUMBER'));
      if (!produktnummer) ohneProdukt++; else produkte.add(produktnummer);
      const menge = leseZahl(row.get('INVOICEDQUANTITY')) ?? 0;
      if (menge === 0) mengeNull++;
      const betrag = leseZahl(row.get('LINEAMOUNT')) ?? 0;
      if (betrag < 0) gutschriften++;
      puffer.push({
        recid, rechnungsnummer, dataAreaId, kundennummer: kopf.kundennummer, rechnungsdatum: datum,
        produktnummer, produktname: leseText(row.get('PRODUCTNAME')) ?? leseText(row.get('PRODUCTDESCRIPTION')),
        menge, verkaufspreis: leseZahl(row.get('SALESPRICE')) ?? 0, betrag, waehrung: leseText(row.get('CURRENCYCODE')) ?? 'EUR',
        importBatchId: batch.id,
      });
      neu++;
      if (puffer.length >= CHUNK) await flush();
      if (quarPuffer.length >= CHUNK) await flushQuar();
    });
    await flush();
    await flushQuar();

    const bericht: SalesImportBericht = {
      typ: 'RECHNUNGSPOSITION', zeilenGesamt: gesamt, zeilenNeu: neu, zeilenAktualisiert: 0, zeilenUebersprungen: skip, zeilenQuarantaene: quar,
      detail: { distinctProdukte: produkte.size, gutschriften, mengeNull, ohneProdukt },
    };
    await this.batchAbschliessen(batch.id, bericht, aktor);
    return { batchId: batch.id, bericht };
  }

  private zaehleGesellschaften(rows: NamedRow[], feld: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of rows) { const v = leseText(r.get(feld)) ?? '—'; out[v] = (out[v] ?? 0) + 1; }
    return out;
  }
  private topN(obj: Record<string, number>, n: number): Record<string, number> {
    return Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n));
  }
  private runde(obj: Record<string, number>): Record<string, number> {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, Math.round(v * 100) / 100]));
  }
}
