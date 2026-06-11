import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BUDGET_GRUPPE_TO_REGION,
  E2_ERHOEHUNG_PLATZHALTER,
  mapBudgetLandName,
  mapE1,
  mapE2,
  type QuarantaeneGrund,
} from '@forecast/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BudgetExcelAdapter, type BudgetRohZeile } from './budget-excel.adapter';

// Spaltenmapping (0-basiert) — gegen die Realdatei verifiziert (ASP = EUR/Units bestätigt):
const COLS = {
  company: 0,
  gruppe: 1,
  e1: 2,
  e2: 3,
  land: 4,
  kst: 5,
  ktr: 6,
  eur2024: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
  eur2025: [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31],
  units2026: [37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48],
  asp: 50,
  eur2026: [51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62],
  jahre: [
    { jahr: 2027, col: 64 },
    { jahr: 2028, col: 65 },
    { jahr: 2029, col: 66 },
    { jahr: 2030, col: 67 },
  ],
} as const;

export interface BudgetImportBericht {
  zeilenGesamt: number;
  budgetZeilen: number;
  reserveZeilen: number;
  zeilenQuarantaene: number;
  summenJeJahr: { jahr: number; summeEur: number }[];
  units2026: number;
}

interface BudgetKandidat extends Prisma.BudgetCreateManyInput {}

const r2 = (x: number): number => Math.round(x * 100) / 100;
const r4 = (x: number): number => Math.round(x * 10000) / 10000;

@Injectable()
export class BudgetImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async importiere(buffer: Buffer, dateiname: string, aktor: { id: string; email: string }): Promise<{ batchId: string; bericht: BudgetImportBericht }> {
    const adapter = new BudgetExcelAdapter(buffer, dateiname);
    const rows = await adapter.lese();
    const meta = adapter.meta();
    const lookups = await this.ladeLookups();

    const batch = await this.prisma.importBatch.create({
      data: { typ: 'BUDGET', dateiname: meta.dateiname, hash: meta.hash, ausgeloestVonId: aktor.id, status: 'HOCHGELADEN', zeilenGesamt: rows.length },
    });

    const kandidaten: BudgetKandidat[] = [];
    const quarantaene: Prisma.ImportQuarantaeneCreateManyInput[] = [];
    const centsByJahr = new Map<number, number>();
    let reserveZeilen = 0;
    let units2026Cents = 0;
    let quar = 0;

    const num = (z: BudgetRohZeile, idx: number): number | null => {
      const v = z.cells[idx];
      if (v === null || v === undefined || v === '') return null;
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isNaN(n) ? null : n;
    };
    const str = (z: BudgetRohZeile, idx: number): string => {
      const v = z.cells[idx];
      return v === null || v === undefined ? '' : String(v).trim();
    };
    const q = (z: BudgetRohZeile, grund: QuarantaeneGrund, detail: string): void => {
      quarantaene.push({ importBatchId: batch.id, zeilenNummer: z.zeilenNummer, rohdaten: z.cells as unknown as Prisma.InputJsonValue, grund, detail });
      quar++;
    };

    for (const z of rows) {
      const gruppe = str(z, COLS.gruppe);
      const regionCode = BUDGET_GRUPPE_TO_REGION[gruppe];
      if (!regionCode) {
        q(z, 'UNBEKANNTE_KOSTENSTELLE', `KST-Gruppe ${gruppe}`);
        continue;
      }
      const kstNr = Number.parseInt(str(z, COLS.kst), 10) || 0;
      const e1r = mapE1(str(z, COLS.e1), kstNr);
      if (!e1r.ok) {
        q(z, 'UNBEKANNTE_E1', e1r.detail);
        continue;
      }
      const e2raw = str(z, COLS.e2);
      const landRaw = str(z, COLS.land);
      const istReserve = landRaw === '(Leer)' || e2raw === E2_ERHOEHUNG_PLATZHALTER;

      let landId: string | null = null;
      let e2Id: string | null = null;
      let e1Id = lookups.e1IdByKat.get(e1r.e1);

      if (!istReserve) {
        const landRes = mapBudgetLandName(landRaw, lookups.nameEnToIso);
        if (!landRes.ok) {
          q(z, 'UNBEKANNTER_LANDNAME', landRaw);
          continue;
        }
        if (landRes.regionsreserve) {
          landId = null;
        } else {
          landId = landRes.iso;
        }
        const e2r = mapE2(e2raw, e1r.e1);
        if (!e2r.ok) {
          q(z, 'UNBEKANNTE_E2', e2r.detail);
          continue;
        }
        e2Id = lookups.e2IdByName.get(e2r.name) ?? null;
        e1Id = lookups.e1IdByKat.get(e2r.e1) ?? e1Id;
      } else {
        reserveZeilen++;
      }
      if (!e1Id) {
        q(z, 'UNBEKANNTE_E1', e1r.e1);
        continue;
      }

      const company = str(z, COLS.company) as Prisma.BudgetCreateManyInput['company'];
      const kostentraeger = str(z, COLS.ktr) || null;
      const asp = num(z, COLS.asp);

      const aspR = asp === null ? null : r4(asp);
      const pushRow = (jahr: number, monat: number | null, eur: number | null, units: number | null, aspWert: number | null): void => {
        kandidaten.push({
          jahr,
          monat,
          regionCode,
          landId,
          e1Id: e1Id as string,
          e2Id,
          company,
          kostentraeger,
          wertEur: eur,
          units,
          asp: aspWert,
          istRegionsreserve: istReserve,
          version: 1,
          status: 'AKTIV',
          importBatchId: batch.id,
        });
        if (eur !== null) centsByJahr.set(jahr, (centsByJahr.get(jahr) ?? 0) + Math.round(eur * 100));
      };
      // Null-Wert-Zellen (gerundet 0) erzeugen KEINE Budget-Zeile -> deterministisch + idempotent.
      const wert = (raw: number | null): number | null => {
        if (raw === null) return null;
        const v = r2(raw);
        return v === 0 ? null : v;
      };

      // 2024 / 2025 (nur EUR)
      COLS.eur2024.forEach((ci, k) => {
        const eur = wert(num(z, ci));
        if (eur !== null) pushRow(2024, k + 1, eur, null, null);
      });
      COLS.eur2025.forEach((ci, k) => {
        const eur = wert(num(z, ci));
        if (eur !== null) pushRow(2025, k + 1, eur, null, null);
      });
      // 2026 (EUR aus 51-62, Units aus 37-48, ASP aus 50)
      COLS.eur2026.forEach((ci, k) => {
        const eur = wert(num(z, ci));
        const units = wert(num(z, COLS.units2026[k]));
        if (units !== null) units2026Cents += Math.round(units * 100);
        if (eur !== null || units !== null) pushRow(2026, k + 1, eur, units, aspR);
      });
      // Jahreswerte 2027-2030 (monat null)
      for (const { jahr, col } of COLS.jahre) {
        const eur = wert(num(z, col));
        if (eur !== null) pushRow(jahr, null, eur, null, null);
      }
    }

    // Versionierung: bei leerer Budget-Tabelle reine Inserts; sonst Diff gegen AKTIV.
    const bestehend = await this.ladeBestehend();
    const inserts: BudgetKandidat[] = [];
    const historisieren: string[] = [];
    let neu = 0;
    let aktualisiert = 0;
    let uebersprungen = 0;
    for (const k of kandidaten) {
      const key = this.naturalKey(k);
      const alt = bestehend.get(key);
      if (!alt) {
        inserts.push(k);
        neu++;
      } else if (this.weichtAb(alt, k)) {
        historisieren.push(alt.id);
        inserts.push({ ...k, version: alt.version + 1 });
        aktualisiert++;
      } else {
        uebersprungen++;
      }
    }
    if (historisieren.length) {
      await this.prisma.budget.updateMany({ where: { id: { in: historisieren } }, data: { status: 'HISTORISIERT' } });
    }
    if (inserts.length) await this.prisma.budget.createMany({ data: inserts });
    if (quarantaene.length) await this.prisma.importQuarantaene.createMany({ data: quarantaene });

    const summenJeJahr = [...centsByJahr.entries()].map(([jahr, cents]) => ({ jahr, summeEur: cents / 100 })).sort((a, b) => a.jahr - b.jahr);
    const bericht: BudgetImportBericht = {
      zeilenGesamt: rows.length,
      budgetZeilen: kandidaten.length,
      reserveZeilen,
      zeilenQuarantaene: quar,
      summenJeJahr,
      units2026: units2026Cents / 100,
    };

    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: { status: 'ABGESCHLOSSEN', abgeschlossenAm: new Date(), zeilenNeu: neu, zeilenAktualisiert: aktualisiert, zeilenUebersprungen: uebersprungen, zeilenQuarantaene: quar, validierungsbericht: bericht as unknown as Prisma.InputJsonValue },
    });
    await this.audit.write({ entitaet: 'ImportBatch', entitaetId: batch.id, aktion: 'IMPORT', userId: aktor.id, userEmail: aktor.email, metadaten: { typ: 'BUDGET', budgetZeilen: kandidaten.length, neu, aktualisiert } });

    return { batchId: batch.id, bericht };
  }

  private naturalKey(b: BudgetKandidat): string {
    return [b.jahr, b.monat ?? 'J', b.regionCode, b.landId ?? '-', b.e1Id, b.e2Id ?? '-', b.company, b.kostentraeger ?? '-'].join('|');
  }

  private weichtAb(alt: { wertEur: number | null; units: number | null; asp: number | null }, neu: BudgetKandidat): boolean {
    const eq = (a: number | null, b: number | null | undefined): boolean => (a ?? null) === (b ?? null);
    return !eq(alt.wertEur, neu.wertEur as number | null) || !eq(alt.units, neu.units as number | null) || !eq(alt.asp, neu.asp as number | null);
  }

  private async ladeBestehend(): Promise<Map<string, { id: string; version: number; wertEur: number | null; units: number | null; asp: number | null }>> {
    const rows = await this.prisma.budget.findMany({
      where: { status: 'AKTIV' },
      select: { id: true, version: true, jahr: true, monat: true, regionCode: true, landId: true, e1Id: true, e2Id: true, company: true, kostentraeger: true, wertEur: true, units: true, asp: true },
    });
    const m = new Map<string, { id: string; version: number; wertEur: number | null; units: number | null; asp: number | null }>();
    for (const r of rows) {
      const key = [r.jahr, r.monat ?? 'J', r.regionCode, r.landId ?? '-', r.e1Id, r.e2Id ?? '-', r.company, r.kostentraeger ?? '-'].join('|');
      m.set(key, { id: r.id, version: r.version, wertEur: r.wertEur === null ? null : Number(r.wertEur), units: r.units === null ? null : Number(r.units), asp: r.asp === null ? null : Number(r.asp) });
    }
    return m;
  }

  private async ladeLookups(): Promise<{ nameEnToIso: Map<string, string>; e1IdByKat: Map<string, string>; e2IdByName: Map<string, string> }> {
    const [laender, e1s, e2s] = await Promise.all([
      this.prisma.land.findMany({ select: { isoCode: true, nameEn: true } }),
      this.prisma.produktgruppeE1.findMany({ select: { id: true, kategorie: true } }),
      this.prisma.produktgruppeE2.findMany({ select: { id: true, name: true } }),
    ]);
    return {
      nameEnToIso: new Map(laender.map((l) => [l.nameEn.toLowerCase(), l.isoCode])),
      e1IdByKat: new Map(e1s.map((e) => [e.kategorie, e.id])),
      e2IdByName: new Map(e2s.map((e) => [e.name, e.id])),
    };
  }
}
