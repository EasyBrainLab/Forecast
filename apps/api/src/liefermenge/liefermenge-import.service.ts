import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, QuarantaeneGrund } from '@prisma/client';
import { E1_LOOKUP, LIEFERMENGE_E2_LOOKUP } from '@forecast/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { LiefermengeQuelleAdapter, RohLiefermengeZeile } from './liefermenge-quelle.adapter';

/** Englisches Zahlformat (Punkt-Dezimal, KEINE Tausendertrenner). Leer/"-" -> null. */
function numEn(s: string): number | null {
  const t = (s ?? '').trim().replace(/^"|"$/g, '');
  if (t === '' || t === '-') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export interface LiefermengeBericht {
  zeilenGesamt: number;
  zeilenNeu: number;
  zeilenAktualisiert: number;
  zeilenUebersprungen: number;
  zeilenQuarantaene: number;
  perioden: { jahr: number; monat: number; zeilen: number }[];
  stueckGesamt: number;
  seedGesamt: number;
  summeLineAmountEur: number;
  jeProdukt: { e1: string; stueck: number; seed: number }[];
}

const CHUNK = 5000;

@Injectable()
export class LiefermengeImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async importiere(adapter: LiefermengeQuelleAdapter, aktor: { id: string; email: string }): Promise<{ batchId: string; bericht: LiefermengeBericht }> {
    const rows = await adapter.lese();
    const { dateiname, hash } = adapter.meta();

    // Stammdaten-Lookups
    const [e1s, e2s, laender, kundenRegion] = await Promise.all([
      this.prisma.produktgruppeE1.findMany({ select: { id: true, kategorie: true } }),
      this.prisma.produktgruppeE2.findMany({ select: { id: true, name: true } }),
      this.prisma.land.findMany({ select: { isoCode: true } }),
      this.prisma.kundeRegion.findMany({ select: { kunde: true, regionCode: true } }),
    ]);
    const e1IdByKat = new Map(e1s.map((e) => [e.kategorie, e.id]));
    const e2IdByName = new Map(e2s.map((e) => [e.name, e.id]));
    const landIso = new Set(laender.map((l) => l.isoCode));
    const kundeRegion = new Map(kundenRegion.map((k) => [k.kunde, k.regionCode]));

    const batch = await this.prisma.importBatch.create({
      data: { typ: 'LIEFERMENGE', dateiname, hash, ausgeloestVonId: aktor.id, status: 'HOCHGELADEN', zeilenGesamt: rows.length },
    });

    const inserts: Prisma.LiefermengeCreateManyInput[] = [];
    const quarantaene: Prisma.ImportQuarantaeneCreateManyInput[] = [];
    const q = (row: RohLiefermengeZeile, grund: QuarantaeneGrund, detail?: string): void => {
      quarantaene.push({ importBatchId: batch.id, zeilenNummer: row.zeilenNummer, rohdaten: row as unknown as Prisma.InputJsonValue, grund, detail: detail ?? null });
    };

    const periodenZeilen = new Map<string, number>(); // "jahr-monat" -> Anzahl
    const jeProdukt = new Map<string, { stueck: number; seed: number }>();
    let stueckGesamt = 0;
    let seedGesamt = 0;
    let summeLineAmountEur = 0;

    for (const row of rows) {
      // 1) Liefermonat aus Shipping_Date
      const md = /^(\d{4})-(\d{2})-(\d{2})/.exec(row.shippingDate);
      if (!md) {
        q(row, 'DATUM_UNGUELTIG', row.shippingDate || '(leer)');
        continue;
      }
      const jahr = Number(md[1]);
      const monat = Number(md[2]);
      const tag = Number(md[3]);
      if (monat < 1 || monat > 12 || tag < 1 || tag > 31) {
        q(row, 'DATUM_UNGUELTIG', row.shippingDate);
        continue;
      }
      const shippingDate = new Date(Date.UTC(jahr, monat - 1, tag));

      // 2) E1 aus SO_Categorie_00 (unmappbar -> Quarantäne)
      const e1Kat = E1_LOOKUP[row.cat00];
      const e1Id = e1Kat ? e1IdByKat.get(e1Kat) : undefined;
      if (!e1Id) {
        q(row, 'UNBEKANNTE_E1', row.cat00 || '(leer)');
        continue;
      }
      // 3) E2 aus SO_Categorie_01 (unmappbar -> Quarantäne)
      const e2Name = LIEFERMENGE_E2_LOOKUP[row.cat01];
      const e2Id = e2Name ? e2IdByName.get(e2Name) : undefined;
      if (!e2Id) {
        q(row, 'UNBEKANNTE_E2', row.cat01 || '(leer)');
        continue;
      }
      // 4) Land: leer -> null (importieren); nicht-leer & unbekannt -> Quarantäne
      const iso = row.countryCode.toUpperCase();
      let landId: string | null = null;
      if (iso) {
        if (!landIso.has(iso)) {
          q(row, 'UNBEKANNTES_LAND', iso);
          continue;
        }
        landId = iso;
      }
      // 5) Mengen (englisch); beide leer -> Quarantäne, sonst null->0
      const sVal = numEn(row.stueckzahl);
      const zVal = numEn(row.seedzahl);
      if (sVal === null && zVal === null) {
        q(row, 'WERT_LEER', `Stueck="${row.stueckzahl}" Seed="${row.seedzahl}"`);
        continue;
      }
      const stueckzahl = sVal ?? 0;
      const seedzahl = zVal ?? 0;

      inserts.push({
        jahr,
        monat,
        shippingDate,
        auftragsnummer: row.auftragsnummer,
        kunde: row.kunde,
        landId,
        regionCode: kundeRegion.get(row.kunde) ?? null,
        e1Id,
        e2Id,
        produktgruppeRoh: row.cat00,
        unterkategorieRoh: row.cat01,
        itemNumber: row.itemNumber,
        stueckzahl,
        seedzahl,
        orderedQty: numEn(row.orderedQty),
        lineAmountEur: numEn(row.lineAmount),
        kostenstelleRoh: row.kostenstelle || null,
        kostentraeger: row.kostentraeger || null,
        dataAreaId: row.dataAreaId || null,
        importBatchId: batch.id,
      });

      const pk = `${jahr}-${monat}`;
      periodenZeilen.set(pk, (periodenZeilen.get(pk) ?? 0) + 1);
      const agg = jeProdukt.get(e1Kat as string) ?? { stueck: 0, seed: 0 };
      agg.stueck += stueckzahl;
      agg.seed += seedzahl;
      jeProdukt.set(e1Kat as string, agg);
      stueckGesamt += stueckzahl;
      seedGesamt += seedzahl;
      summeLineAmountEur += numEn(row.lineAmount) ?? 0;
    }

    // Schutz: keine Periode leeren, wenn die Datei keine validen Zeilen liefert.
    if (inserts.length === 0) {
      await this.prisma.importBatch.update({ where: { id: batch.id }, data: { status: 'FEHLGESCHLAGEN', abgeschlossenAm: new Date(), zeilenQuarantaene: quarantaene.length } });
      if (quarantaene.length) await this.prisma.importQuarantaene.createMany({ data: quarantaene });
      throw new BadRequestException(`Keine validen Liefermengen-Zeilen erkannt (${quarantaene.length} in Quarantäne). Bestehende Daten bleiben unverändert. Bitte Datei/Spalten prüfen.`);
    }

    // Voll-Ersatz je enthaltenem Liefermonat (deleteMany + createMany atomar).
    const orFilter = [...periodenZeilen.keys()].map((p) => {
      const [j, m] = p.split('-').map(Number);
      return { jahr: j, monat: m };
    });
    const ops: Prisma.PrismaPromise<unknown>[] = [this.prisma.liefermenge.deleteMany({ where: { OR: orFilter } })];
    for (let i = 0; i < inserts.length; i += CHUNK) {
      ops.push(this.prisma.liefermenge.createMany({ data: inserts.slice(i, i + CHUNK) }));
    }
    await this.prisma.$transaction(ops);
    if (quarantaene.length) await this.prisma.importQuarantaene.createMany({ data: quarantaene });

    const bericht: LiefermengeBericht = {
      zeilenGesamt: rows.length,
      zeilenNeu: inserts.length,
      zeilenAktualisiert: 0,
      zeilenUebersprungen: 0,
      zeilenQuarantaene: quarantaene.length,
      perioden: [...periodenZeilen.entries()]
        .map(([p, zeilen]) => {
          const [j, m] = p.split('-').map(Number);
          return { jahr: j, monat: m, zeilen };
        })
        .sort((a, b) => a.jahr - b.jahr || a.monat - b.monat),
      stueckGesamt: Math.round(stueckGesamt),
      seedGesamt: Math.round(seedGesamt),
      summeLineAmountEur: Math.round(summeLineAmountEur * 100) / 100,
      jeProdukt: [...jeProdukt.entries()].map(([e1, v]) => ({ e1, stueck: Math.round(v.stueck), seed: Math.round(v.seed) })),
    };

    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        status: 'ABGESCHLOSSEN',
        abgeschlossenAm: new Date(),
        zeilenNeu: inserts.length,
        zeilenQuarantaene: quarantaene.length,
        validierungsbericht: bericht as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.write({ entitaet: 'ImportBatch', entitaetId: batch.id, aktion: 'IMPORT', userId: aktor.id, userEmail: aktor.email, metadaten: { typ: 'LIEFERMENGE', ...bericht } });
    return { batchId: batch.id, bericht };
  }
}
