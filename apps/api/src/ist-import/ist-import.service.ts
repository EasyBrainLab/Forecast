import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  EINSTELLUNG_KEYS,
  MONAT_DE_TO_NUM,
  mapE1,
  mapE2,
  normalizeCountryRaw,
  parseDecimalDe,
  type QuarantaeneGrund,
} from '@forecast/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { IstQuelleAdapter, RohIstZeile } from './ist-quelle.adapter';

const COMPANIES = new Set(['BBD', 'BBE', 'BBF', 'BMW']);

interface KstInfo {
  id: string;
  regionCode: string;
  istSammel: boolean;
}
interface Lookups {
  kstByNummer: Map<number, KstInfo>;
  landIso: Set<string>;
  e1IdByKat: Map<string, string>;
  e2IdByName: Map<string, string>;
}
interface ExistingRow {
  wertEur: number;
  kostenstelleId: string;
  landId: string | null;
  e1Id: string;
  e2Id: string | null;
  buchungsdatum: number;
}

export interface ImportBericht {
  zeilenGesamt: number;
  zeilenNeu: number;
  zeilenAktualisiert: number;
  zeilenUebersprungen: number;
  zeilenQuarantaene: number;
  e2Unbekannt: number;
  vorzeichenVerstoesse: number;
  summenJeRegion: { regionCode: string; summeEur: number }[];
  summeGesamtEur: number;
}

@Injectable()
export class IstImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async importiere(adapter: IstQuelleAdapter, aktor: { id: string; email: string }): Promise<{ batchId: string; bericht: ImportBericht }> {
    const rows = await adapter.lese();
    const meta = adapter.meta();
    const lookups = await this.ladeLookups();
    const whitelist = await this.postingtypeWhitelist();
    const existing = await this.ladeExisting();

    const batch = await this.prisma.importBatch.create({
      data: { typ: 'IST', dateiname: meta.dateiname, hash: meta.hash, ausgeloestVonId: aktor.id, status: 'HOCHGELADEN', zeilenGesamt: rows.length },
    });

    const inserts: Prisma.IstUmsatzCreateManyInput[] = [];
    const quarantaene: Prisma.ImportQuarantaeneCreateManyInput[] = [];
    const updates: { recid: string; data: Prisma.IstUmsatzCreateManyInput; alt: ExistingRow }[] = [];
    const seenRecids = new Set<string>();
    const sumCentsByRegion = new Map<string, number>();
    let neu = 0,
      akt = 0,
      skip = 0,
      quar = 0,
      e2Unbekannt = 0,
      vorzeichenVerstoesse = 0,
      uebersprungenWhitelist = 0;

    const q = (row: RohIstZeile, grund: QuarantaeneGrund, detail?: string): void => {
      quarantaene.push({
        importBatchId: batch.id,
        zeilenNummer: row.zeilenNummer,
        recid: row.recid.trim() || null,
        rohdaten: row as unknown as Prisma.InputJsonValue,
        grund,
        detail: detail ?? null,
      });
      quar++;
    };

    for (const row of rows) {
      if (whitelist.size > 0 && !whitelist.has(row.postingtype.trim())) {
        uebersprungenWhitelist++;
        continue;
      }
      const kstNr = Number.parseInt(row.kostenstelle, 10);
      const kst = Number.isNaN(kstNr) ? undefined : lookups.kstByNummer.get(kstNr);
      if (!kst) {
        q(row, 'UNBEKANNTE_KOSTENSTELLE', row.kostenstelle);
        continue;
      }
      const company = row.dataareaid.trim();
      if (!COMPANIES.has(company)) {
        q(row, 'COMPANY_UNBEKANNT', company);
        continue;
      }
      const cr = normalizeCountryRaw(row.country);
      if (!cr.ok) {
        q(row, 'LAND_LEER');
        continue;
      }
      if (!lookups.landIso.has(cr.iso)) {
        q(row, 'UNBEKANNTES_LAND', cr.iso);
        continue;
      }
      const e1r = mapE1(row.ktreb1, kstNr);
      if (!e1r.ok) {
        q(row, 'UNBEKANNTE_E1', e1r.detail);
        continue;
      }
      const e2r = mapE2(row.ktreb2, e1r.e1);
      if (!e2r.ok) {
        q(row, 'UNBEKANNTE_E2', e2r.detail);
        continue;
      }
      if (e2r.istPlatzhalter) e2Unbekannt++;
      const finalE1Kat = kst.istSammel ? 'ZENTRAL' : e2r.e1;
      const e1Id = lookups.e1IdByKat.get(finalE1Kat);
      const e2Id = lookups.e2IdByName.get(e2r.name);
      if (!e1Id || !e2Id) {
        q(row, 'UNBEKANNTE_E2', e2r.name);
        continue;
      }
      let v: number | null;
      let acc: number | null;
      try {
        v = parseDecimalDe(row.value);
        acc = parseDecimalDe(row.accountingAmount);
      } catch {
        q(row, 'WERT_LEER', row.value);
        continue;
      }
      if (v === null) {
        q(row, 'WERT_LEER');
        continue;
      }
      if (acc !== null && Math.abs(v + acc) > 0.005) {
        vorzeichenVerstoesse++;
        q(row, 'VORZEICHEN_INKONSISTENT');
        continue;
      }
      const monat = MONAT_DE_TO_NUM[row.monat.trim()];
      if (!monat) {
        q(row, 'UNBEKANNTER_MONAT', row.monat);
        continue;
      }
      const jahr = Number.parseInt(row.jahr, 10);
      const tag = Number.parseInt(row.tag, 10) || 1;
      const buchungsdatum = new Date(Date.UTC(jahr, monat - 1, tag));
      const recid = row.recid.trim();
      if (!recid) {
        q(row, 'WERT_LEER', 'RECID leer');
        continue;
      }
      if (seenRecids.has(recid)) {
        q(row, 'RECID_DUP_IN_DATEI', recid);
        continue;
      }
      seenRecids.add(recid);

      sumCentsByRegion.set(kst.regionCode, (sumCentsByRegion.get(kst.regionCode) ?? 0) + Math.round(v * 100));

      const daten: Prisma.IstUmsatzCreateManyInput = {
        recid,
        dataareaid: company,
        buchungsdatum,
        jahr,
        monat,
        kostenstelleId: kst.id,
        landId: cr.iso,
        e1Id,
        e2Id,
        kostentraeger: row.kostentraeger.trim() || null,
        sachkonto: row.sachkonto.trim() || null,
        postingtype: row.postingtype.trim() || null,
        wertEur: v,
        importBatchId: batch.id,
      };
      const existingRow = existing.get(recid);
      if (!existingRow) {
        inserts.push(daten);
        neu++;
      } else if (this.weichtAb(existingRow, daten, buchungsdatum)) {
        updates.push({ recid, data: daten, alt: existingRow });
        akt++;
      } else {
        skip++;
      }
    }

    if (inserts.length) await this.prisma.istUmsatz.createMany({ data: inserts });
    for (const u of updates) {
      await this.prisma.$transaction(async (tx) => {
        await tx.istUmsatz.update({ where: { recid: u.recid }, data: u.data });
        await this.audit.write(
          {
            entitaet: 'IstUmsatz',
            entitaetId: u.recid,
            aktion: 'UPDATE',
            userId: aktor.id,
            userEmail: aktor.email,
            vorherWert: { wertEur: u.alt.wertEur },
            nachherWert: { wertEur: u.data.wertEur },
          },
          tx,
        );
      });
    }
    if (quarantaene.length) await this.prisma.importQuarantaene.createMany({ data: quarantaene });

    const summenJeRegion = [...sumCentsByRegion.entries()]
      .map(([regionCode, cents]) => ({ regionCode, summeEur: cents / 100 }))
      .sort((a, b) => a.regionCode.localeCompare(b.regionCode));
    const summeGesamtEur = Math.round(summenJeRegion.reduce((s, r) => s + r.summeEur, 0) * 100) / 100;
    const bericht: ImportBericht = {
      zeilenGesamt: rows.length,
      zeilenNeu: neu,
      zeilenAktualisiert: akt,
      zeilenUebersprungen: skip + uebersprungenWhitelist,
      zeilenQuarantaene: quar,
      e2Unbekannt,
      vorzeichenVerstoesse,
      summenJeRegion,
      summeGesamtEur,
    };

    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        status: 'ABGESCHLOSSEN',
        abgeschlossenAm: new Date(),
        zeilenNeu: neu,
        zeilenAktualisiert: akt,
        zeilenUebersprungen: skip + uebersprungenWhitelist,
        zeilenQuarantaene: quar,
        validierungsbericht: bericht as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.write({
      entitaet: 'ImportBatch',
      entitaetId: batch.id,
      aktion: 'IMPORT',
      userId: aktor.id,
      userEmail: aktor.email,
      metadaten: { typ: 'IST', summeGesamtEur, zeilenNeu: neu, zeilenAktualisiert: akt, zeilenQuarantaene: quar },
    });

    return { batchId: batch.id, bericht };
  }

  private weichtAb(alt: ExistingRow, neu: Prisma.IstUmsatzCreateManyInput, buchungsdatum: Date): boolean {
    return (
      alt.wertEur !== Number(neu.wertEur) ||
      alt.kostenstelleId !== neu.kostenstelleId ||
      (alt.landId ?? null) !== (neu.landId ?? null) ||
      alt.e1Id !== neu.e1Id ||
      (alt.e2Id ?? null) !== (neu.e2Id ?? null) ||
      alt.buchungsdatum !== buchungsdatum.getTime()
    );
  }

  private async ladeLookups(): Promise<Lookups> {
    const [ksts, laender, e1s, e2s] = await Promise.all([
      this.prisma.kostenstelle.findMany({ select: { id: true, nummer: true, regionCode: true, istSammel: true } }),
      this.prisma.land.findMany({ select: { isoCode: true } }),
      this.prisma.produktgruppeE1.findMany({ select: { id: true, kategorie: true } }),
      this.prisma.produktgruppeE2.findMany({ select: { id: true, name: true } }),
    ]);
    return {
      kstByNummer: new Map(ksts.map((k) => [Number(k.nummer), { id: k.id, regionCode: k.regionCode, istSammel: k.istSammel }])),
      landIso: new Set(laender.map((l) => l.isoCode)),
      e1IdByKat: new Map(e1s.map((e) => [e.kategorie, e.id])),
      e2IdByName: new Map(e2s.map((e) => [e.name, e.id])),
    };
  }

  private async ladeExisting(): Promise<Map<string, ExistingRow>> {
    const rows = await this.prisma.istUmsatz.findMany({
      select: { recid: true, wertEur: true, kostenstelleId: true, landId: true, e1Id: true, e2Id: true, buchungsdatum: true },
    });
    const m = new Map<string, ExistingRow>();
    for (const r of rows) {
      m.set(r.recid, {
        wertEur: Number(r.wertEur),
        kostenstelleId: r.kostenstelleId,
        landId: r.landId,
        e1Id: r.e1Id,
        e2Id: r.e2Id,
        buchungsdatum: r.buchungsdatum.getTime(),
      });
    }
    return m;
  }

  private async postingtypeWhitelist(): Promise<Set<string>> {
    const e = await this.prisma.einstellung.findUnique({ where: { key: EINSTELLUNG_KEYS.POSTINGTYPE_WHITELIST } });
    const wert = (e?.value ?? '').trim();
    if (!wert) return new Set();
    return new Set(wert.split(',').map((s) => s.trim()).filter(Boolean));
  }
}
