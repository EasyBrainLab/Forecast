import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { parseSalesFlash } from './sales-flash.parser';
import { parseRegionExcel } from './sales-flash-detail.parser';

const round2 = (x: number): number => Math.round(x * 100) / 100;

export interface Actuals {
  total: number | null;
  regionen: { regionCode: string; eur: number }[];
}

@Injectable()
export class SalesFlashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private cleanActuals(a: unknown): Actuals {
    const o = (a ?? {}) as Record<string, unknown>;
    const regionen = Array.isArray(o.regionen)
      ? (o.regionen as Record<string, unknown>[])
          .map((r) => ({ regionCode: String(r.regionCode ?? '').trim(), eur: Number(r.eur ?? 0) }))
          .filter((r) => r.regionCode)
      : [];
    return { total: o.total === null || o.total === undefined ? null : Number(o.total), regionen };
  }

  /** PDF-Beleg je Monat ablegen (Voll-Ersatz pro (jahr,monat)) + Region-Actuals automatisch auslesen. */
  async upload(buffer: Buffer, dateiname: string, mimeType: string, jahr: number, monat: number, aktor: RequestUser) {
    if (!jahr || !monat || monat < 1 || monat > 12) throw new BadRequestException('jahr & monat (1-12) erforderlich.');
    const vorhanden = await this.prisma.salesFlashDokument.findUnique({ where: { jahr_monat: { jahr, monat } }, select: { id: true, actuals: true } });

    // Region-Actuals aus dem PDF auslesen (Fallback: manuelle Erfassung, wenn Layout nicht passt)
    const parsed = mimeType.includes('pdf') ? await parseSalesFlash(buffer) : null;
    const actualsAusPdf = parsed ? ({ total: parsed.total, regionen: parsed.regionen } as unknown as Prisma.InputJsonValue) : undefined;
    // Bereits (ggf. manuell) erfasste Actuals beim Re-Upload NICHT durch den Parser überschreiben.
    const bestehend = vorhanden ? this.cleanActuals(vorhanden.actuals) : null;
    const bestehendErfasst = !!bestehend && (bestehend.total !== null || bestehend.regionen.length > 0);
    const autoUebernommen = !!actualsAusPdf && !bestehendErfasst;

    const result = await this.prisma.salesFlashDokument.upsert({
      where: { jahr_monat: { jahr, monat } },
      update: { dateiname, mimeType, groesseBytes: buffer.length, inhalt: buffer, hochgeladenVonId: aktor.id, hochgeladenVon: aktor.email, ...(autoUebernommen ? { actuals: actualsAusPdf } : {}) },
      create: { jahr, monat, dateiname, mimeType, groesseBytes: buffer.length, inhalt: buffer, actuals: actualsAusPdf ?? {}, hochgeladenVonId: aktor.id, hochgeladenVon: aktor.email },
    });
    await this.audit.write({ entitaet: 'SalesFlashDokument', entitaetId: result.id, aktion: 'IMPORT', userId: aktor.id, userEmail: aktor.email, metadaten: { jahr, monat, dateiname, groesseBytes: buffer.length, ersetzt: !!vorhanden, autoActuals: autoUebernommen, manuelleBeibehalten: bestehendErfasst } });
    return {
      id: result.id,
      jahr,
      monat,
      dateiname,
      groesseBytes: buffer.length,
      ersetzt: !!vorhanden,
      autoAusgelesen: autoUebernommen,
      manuelleActualsBeibehalten: bestehendErfasst,
      total: autoUebernommen ? (parsed?.total ?? null) : (bestehend?.total ?? null),
      regionenErkannt: autoUebernommen ? (parsed?.regionen.length ?? 0) : (bestehend?.regionen.length ?? 0),
    };
  }

  async list() {
    const docs = await this.prisma.salesFlashDokument.findMany({
      orderBy: [{ jahr: 'desc' }, { monat: 'desc' }],
      select: { id: true, jahr: true, monat: true, dateiname: true, groesseBytes: true, mimeType: true, actuals: true, kommentar: true, hochgeladenVon: true, erstelltAm: true },
    });
    return docs.map((d) => {
      const a = this.cleanActuals(d.actuals);
      return { ...d, actualsErfasst: a.total !== null || a.regionen.length > 0 };
    });
  }

  async download(id: string) {
    const doc = await this.prisma.salesFlashDokument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Beleg nicht gefunden.');
    return { dateiname: doc.dateiname, mimeType: doc.mimeType, inhalt: Buffer.from(doc.inhalt) };
  }

  /** Controlling-Actuals (gesamt + je Region) erfassen — Grundlage der Reconciliation. */
  async setActuals(jahr: number, monat: number, actuals: unknown, kommentar: string | null, aktor: RequestUser) {
    const doc = await this.prisma.salesFlashDokument.findUnique({ where: { jahr_monat: { jahr, monat } }, select: { id: true } });
    if (!doc) throw new NotFoundException('Für diesen Monat ist noch kein Sales-Flash-Beleg hinterlegt.');
    const clean = this.cleanActuals(actuals);
    const result = await this.prisma.salesFlashDokument.update({ where: { id: doc.id }, data: { actuals: clean as unknown as Prisma.InputJsonValue, kommentar } });
    await this.audit.write({ entitaet: 'SalesFlashDokument', entitaetId: result.id, aktion: 'UPDATE', userId: aktor.id, userEmail: aktor.email, metadaten: { jahr, monat, actuals: clean } });
    return { jahr, monat, actuals: clean, kommentar };
  }

  /** Tool-Ist (GL) je Region Jan..monat vs. Controlling-Actual (Sales Flash) + Delta. */
  async reconciliation(jahr: number, monat: number) {
    const doc = await this.prisma.salesFlashDokument.findUnique({ where: { jahr_monat: { jahr, monat } } });
    const actuals = this.cleanActuals(doc?.actuals);
    const actualByRegion = new Map(actuals.regionen.map((r) => [r.regionCode, r.eur]));

    const [ksts, regionen, istGrp] = await Promise.all([
      this.prisma.kostenstelle.findMany({ select: { id: true, regionCode: true } }),
      this.prisma.region.findMany({ where: { forecastRelevant: true }, select: { code: true, bezeichnung: true }, orderBy: { code: 'asc' } }),
      this.prisma.istUmsatz.groupBy({ by: ['kostenstelleId'], where: { jahr, monat: { lte: monat } }, _sum: { wertEur: true } }),
    ]);
    const regByKst = new Map(ksts.map((k) => [k.id, k.regionCode]));
    const istByRegion = new Map<string, number>();
    for (const g of istGrp) {
      const rc = regByKst.get(g.kostenstelleId);
      if (rc) istByRegion.set(rc, (istByRegion.get(rc) ?? 0) + Number(g._sum.wertEur ?? 0));
    }

    const zeilen = regionen.map((r) => {
      const toolIst = istByRegion.get(r.code) ?? 0;
      const controlling = actualByRegion.get(r.code) ?? null;
      const delta = controlling === null ? null : controlling - toolIst;
      return {
        regionCode: r.code,
        bezeichnung: r.bezeichnung,
        toolIst: round2(toolIst),
        controllingActual: controlling === null ? null : round2(controlling),
        deltaEur: delta === null ? null : round2(delta),
        deltaProzent: delta === null || toolIst === 0 ? null : round2((delta / Math.abs(toolIst)) * 100),
      };
    });
    // Nur forecast-relevante Regionen summieren (ZENTRAL ist nicht Teil des Sales-Flash-Totals) -> sauberer Abgleich.
    // Der Fallback (kein actuals.total) summiert NUR die in den Zeilen gezeigten forecast-relevanten Actuals — konsistent zu toolIstGesamt.
    const toolIstGesamt = zeilen.reduce((s, z) => s + z.toolIst, 0);
    const hatRegionActuals = zeilen.some((z) => z.controllingActual !== null);
    const controllingGesamt = actuals.total ?? (hatRegionActuals ? zeilen.reduce((s, z) => s + (z.controllingActual ?? 0), 0) : null);
    const deltaGesamt = controllingGesamt === null ? null : controllingGesamt - toolIstGesamt;

    return {
      jahr,
      monat,
      belegVorhanden: !!doc,
      actualsErfasst: actuals.total !== null || actuals.regionen.length > 0,
      kommentar: doc?.kommentar ?? null,
      zeilen,
      gesamt: {
        toolIst: round2(toolIstGesamt),
        controllingActual: controllingGesamt === null ? null : round2(controllingGesamt),
        deltaEur: deltaGesamt === null ? null : round2(deltaGesamt),
        deltaProzent: deltaGesamt === null || toolIstGesamt === 0 ? null : round2((deltaGesamt / Math.abs(toolIstGesamt)) * 100),
      },
      hinweis:
        'Tool-Ist stammt aus dem GL-Abriss (External Revenue). Der Sales-Flash-Actual des Controllings nutzt eine breitere Umsatz-/Produktabgrenzung (u. a. S12, SagiNova, X-Ray, HDR Projects) und kann daher abweichen. Das Delta ist erwartbar und macht die Differenz transparent.',
    };
  }

  /**
   * Region-Excel (Controlling) hochladen: granulare Actual-Werte je Produktgruppe × Land × Monat parsen,
   * auf E1/Land der Stammdaten mappen und je (jahr, monat, regionCode) als Voll-Ersatz ablegen.
   */
  async uploadDetail(buffer: Buffer, dateiname: string, jahr: number, monat: number, regionCode: string, aktor: RequestUser) {
    if (!jahr || !monat || monat < 1 || monat > 12) throw new BadRequestException('jahr & monat (1-12) erforderlich.');
    if (!regionCode) throw new BadRequestException('regionCode erforderlich.');
    const parsed = await parseRegionExcel(buffer);

    const [e1s, laender] = await Promise.all([
      this.prisma.produktgruppeE1.findMany({ select: { id: true, nameDe: true, nameEn: true, synonyme: true } }),
      this.prisma.land.findMany({ select: { isoCode: true, nameDe: true, nameEn: true } }),
    ]);
    const e1Map = new Map<string, string>();
    for (const e of e1s) for (const k of [e.nameEn, e.nameDe, ...e.synonyme]) if (k) e1Map.set(k.toLowerCase().trim(), e.id);
    const landMap = new Map<string, string>();
    for (const l of laender) for (const k of [l.nameEn, l.nameDe]) if (k) landMap.set(k.toLowerCase().trim(), l.isoCode);

    const zeilen: Prisma.SalesFlashDetailCreateManyInput[] = [];
    const unmatchedPg = new Set<string>();
    const unmatchedLand = new Set<string>();
    for (const z of parsed.zeilen) {
      const e1Id = e1Map.get(z.produktgruppeRoh.toLowerCase().trim());
      if (!e1Id) {
        unmatchedPg.add(z.produktgruppeRoh);
        continue;
      }
      const landId = z.landRoh ? (landMap.get(z.landRoh.toLowerCase().trim()) ?? null) : null;
      if (z.landRoh && !landId) {
        unmatchedLand.add(z.landRoh);
        continue;
      }
      for (let m = 0; m < 12; m++) {
        const v = z.actualProMonat[m];
        if (v === null || v === 0) continue;
        zeilen.push({ jahr, monat, regionCode, e1Id, landId, periodenMonat: m + 1, actualEur: round2(v), produktgruppeRoh: z.produktgruppeRoh, landRoh: z.landRoh, dateiname, hochgeladenVon: aktor.email });
      }
    }

    await this.prisma.$transaction([
      this.prisma.salesFlashDetail.deleteMany({ where: { jahr, monat, regionCode } }),
      ...(zeilen.length ? [this.prisma.salesFlashDetail.createMany({ data: zeilen })] : []),
    ]);
    await this.audit.write({
      entitaet: 'SalesFlashDetail',
      entitaetId: `${jahr}-${monat}-${regionCode}`,
      aktion: 'IMPORT',
      userId: aktor.id,
      userEmail: aktor.email,
      metadaten: { jahr, monat, regionCode, dateiname, zeilen: zeilen.length, produktgruppenOhneZuordnung: [...unmatchedPg], laenderOhneZuordnung: [...unmatchedLand] },
    });
    return { jahr, monat, regionCode, dateiname, zeilenGespeichert: zeilen.length, produktgruppenOhneZuordnung: [...unmatchedPg], laenderOhneZuordnung: [...unmatchedLand] };
  }

  /** Welche Region-Detailbelege sind je (jahr, monat) hinterlegt? */
  async detailStaende() {
    const grp = await this.prisma.salesFlashDetail.groupBy({ by: ['jahr', 'monat', 'regionCode'], _count: { _all: true }, _max: { erstelltAm: true } });
    return grp
      .map((g) => ({ jahr: g.jahr, monat: g.monat, regionCode: g.regionCode, zeilen: g._count._all, stand: g._max.erstelltAm }))
      .sort((a, b) => b.jahr - a.jahr || b.monat - a.monat || a.regionCode.localeCompare(b.regionCode));
  }

  /** Granularer Abgleich Controlling-Actual (aus Region-Excel) vs. Tool-Ist (GL) je Produktgruppe × Land. */
  async detailAbgleich(jahr: number, monat: number, regionCode?: string) {
    const detailWhere: Prisma.SalesFlashDetailWhereInput = { jahr, monat, periodenMonat: { lte: monat } };
    if (regionCode) detailWhere.regionCode = regionCode;

    const [detailGrp, ksts, e1s, laender] = await Promise.all([
      this.prisma.salesFlashDetail.groupBy({ by: ['regionCode', 'e1Id', 'landId'], where: detailWhere, _sum: { actualEur: true } }),
      this.prisma.kostenstelle.findMany({ select: { id: true, regionCode: true } }),
      this.prisma.produktgruppeE1.findMany({ select: { id: true, nameDe: true } }),
      this.prisma.land.findMany({ select: { isoCode: true, nameDe: true } }),
    ]);
    const regByKst = new Map(ksts.map((k) => [k.id, k.regionCode]));
    const e1Name = new Map(e1s.map((e) => [e.id, e.nameDe]));
    const landName = new Map(laender.map((l) => [l.isoCode, l.nameDe]));

    const zielRegionen = regionCode ? [regionCode] : [...new Set(detailGrp.map((d) => d.regionCode))];
    const kstIn = ksts.filter((k) => zielRegionen.includes(k.regionCode)).map((k) => k.id);
    const istGrp = await this.prisma.istUmsatz.groupBy({
      by: ['kostenstelleId', 'e1Id', 'landId'],
      where: { jahr, monat: { lte: monat }, kostenstelleId: { in: kstIn.length ? kstIn : ['__none__'] } },
      _sum: { wertEur: true },
    });

    const istByKey = new Map<string, number>();
    for (const g of istGrp) {
      const rc = regByKst.get(g.kostenstelleId);
      if (!rc) continue;
      const key = `${rc}|${g.e1Id}|${g.landId ?? ''}`;
      istByKey.set(key, (istByKey.get(key) ?? 0) + Number(g._sum.wertEur ?? 0));
    }
    const controllingByKey = new Map<string, number>();
    const keys = new Set<string>();
    for (const d of detailGrp) {
      const key = `${d.regionCode}|${d.e1Id}|${d.landId ?? ''}`;
      controllingByKey.set(key, Number(d._sum.actualEur ?? 0));
      keys.add(key);
    }
    for (const k of istByKey.keys()) keys.add(k);

    const zeilen = [...keys]
      .map((key) => {
        const [rc, e1Id, landId] = key.split('|');
        const controlling = controllingByKey.get(key) ?? null;
        const toolIst = istByKey.get(key) ?? 0;
        const delta = controlling === null ? null : controlling - toolIst;
        return {
          regionCode: rc,
          produktgruppe: e1Name.get(e1Id) ?? e1Id,
          land: landId ? (landName.get(landId) ?? landId) : '—',
          controllingActual: controlling === null ? null : round2(controlling),
          toolIst: round2(toolIst),
          deltaEur: delta === null ? null : round2(delta),
          deltaProzent: delta === null || toolIst === 0 ? null : round2((delta / Math.abs(toolIst)) * 100),
        };
      })
      .sort((a, b) => Math.abs(b.deltaEur ?? 0) - Math.abs(a.deltaEur ?? 0));

    const summe = zeilen.reduce(
      (acc, z) => ({ controlling: acc.controlling + (z.controllingActual ?? 0), tool: acc.tool + z.toolIst }),
      { controlling: 0, tool: 0 },
    );
    const deltaGesamt = summe.controlling - summe.tool;
    return {
      jahr,
      monat,
      regionCode: regionCode ?? null,
      belegVorhanden: detailGrp.length > 0,
      zeilen,
      gesamt: {
        controllingActual: round2(summe.controlling),
        toolIst: round2(summe.tool),
        deltaEur: round2(deltaGesamt),
        deltaProzent: summe.tool === 0 ? null : round2((deltaGesamt / Math.abs(summe.tool)) * 100),
      },
    };
  }
}
