import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';

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

  /** PDF-Beleg je Monat ablegen (Voll-Ersatz pro (jahr,monat)). */
  async upload(buffer: Buffer, dateiname: string, mimeType: string, jahr: number, monat: number, aktor: RequestUser) {
    if (!jahr || !monat || monat < 1 || monat > 12) throw new BadRequestException('jahr & monat (1-12) erforderlich.');
    const vorhanden = await this.prisma.salesFlashDokument.findUnique({ where: { jahr_monat: { jahr, monat } }, select: { id: true, actuals: true, kommentar: true } });
    const result = await this.prisma.salesFlashDokument.upsert({
      where: { jahr_monat: { jahr, monat } },
      update: { dateiname, mimeType, groesseBytes: buffer.length, inhalt: buffer, hochgeladenVonId: aktor.id, hochgeladenVon: aktor.email },
      create: { jahr, monat, dateiname, mimeType, groesseBytes: buffer.length, inhalt: buffer, actuals: {}, hochgeladenVonId: aktor.id, hochgeladenVon: aktor.email },
    });
    await this.audit.write({ entitaet: 'SalesFlashDokument', entitaetId: result.id, aktion: 'IMPORT', userId: aktor.id, userEmail: aktor.email, metadaten: { jahr, monat, dateiname, groesseBytes: buffer.length, ersetzt: !!vorhanden } });
    return { id: result.id, jahr, monat, dateiname, groesseBytes: buffer.length, ersetzt: !!vorhanden };
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
    const toolIstGesamt = [...istByRegion.values()].reduce((s, v) => s + v, 0);
    const controllingGesamt = actuals.total ?? (actuals.regionen.length ? actuals.regionen.reduce((s, r) => s + r.eur, 0) : null);
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
}
