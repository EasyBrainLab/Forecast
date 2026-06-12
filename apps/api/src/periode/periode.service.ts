import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DashboardService } from '../dashboard/dashboard.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';

const round2 = (x: number): number => Math.round(x * 100) / 100;
type Ampel = 'gruen' | 'gelb' | 'rot' | 'grau';

interface SfActuals {
  total?: number | null;
  regionen?: { regionCode: string; eur: number }[];
}

@Injectable()
export class PeriodeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly dashboard: DashboardService,
  ) {}

  /** Monats-Status-Board: je Monat Quellen-Vollständigkeit + Abgleich + Freigabe-Ampel. */
  async uebersicht(jahr: number) {
    const { toleranz } = await this.dashboard.istEinstellungen();
    const now = new Date();
    const aktJahr = now.getUTCFullYear();
    const aktMonat = now.getUTCMonth() + 1;

    const [glGrp, sfDocs, absGrp, abschluesse] = await Promise.all([
      this.prisma.istUmsatz.groupBy({ by: ['monat'], where: { jahr }, _sum: { wertEur: true } }),
      this.prisma.salesFlashDokument.findMany({ where: { jahr }, select: { monat: true, actuals: true } }),
      this.prisma.absatz.groupBy({ by: ['bisMonat'], where: { jahr }, _sum: { seeds: true } }),
      this.prisma.periodenAbschluss.findMany({ where: { jahr } }),
    ]);

    const glMon = new Map(glGrp.map((g) => [g.monat, Number(g._sum.wertEur ?? 0)]));
    const sfMon = new Map(sfDocs.map((d) => [d.monat, d.actuals as unknown as SfActuals]));
    const absMon = new Map(absGrp.map((g) => [g.bisMonat, Number(g._sum.seeds ?? 0)]));
    const abschlussMon = new Map(abschluesse.map((a) => [a.monat, a]));

    // GL kumulativ (Jan..Monat) für den Summen-Abgleich gegen die kumulierten Sales-Flash-Werte
    let glKum = 0;
    const monate = [];
    for (let m = 1; m <= 12; m++) {
      glKum += glMon.get(m) ?? 0;
      const sf = sfMon.get(m);
      const sfTotal = sf ? (sf.total ?? (sf.regionen ?? []).reduce((s, r) => s + r.eur, 0)) : null;
      const sfActualsErfasst = !!sf && (sf.total != null || (sf.regionen?.length ?? 0) > 0);
      const glVorhanden = (glMon.get(m) ?? 0) !== 0 || glKum !== 0;
      const absVorhanden = absMon.has(m);
      const abgeschlossen = abschlussMon.get(m)?.abgeschlossen ?? false;

      const deltaEur = sfActualsErfasst && sfTotal != null ? round2(sfTotal - glKum) : null;
      const deltaProzent = deltaEur != null && glKum !== 0 ? round2((deltaEur / Math.abs(glKum)) * 100) : null;
      const imToleranz = deltaProzent != null ? Math.abs(deltaProzent) <= toleranz : null;

      const zukunft = jahr > aktJahr || (jahr === aktJahr && m > aktMonat);
      const alleQuellen = glVorhanden && sfActualsErfasst && absVorhanden;
      // grau=Zukunft, gruen=freigegeben, rot=Quelle fehlt, gelb=vollständig aber noch nicht freigegeben (ggf. Delta > Toleranz)
      let ampel: Ampel;
      if (zukunft) ampel = 'grau';
      else if (abgeschlossen) ampel = 'gruen';
      else if (!alleQuellen) ampel = 'rot';
      else ampel = 'gelb';

      monate.push({
        jahr,
        monat: m,
        zukunft,
        gl: { vorhanden: glVorhanden, kumuliertEur: round2(glKum) },
        salesFlash: { vorhanden: !!sf, actualsErfasst: sfActualsErfasst, totalEur: sfTotal == null ? null : round2(sfTotal) },
        absatz: { vorhanden: absVorhanden, seeds: round2(absMon.get(m) ?? 0) },
        abgleich: { deltaEur, deltaProzent, imToleranz },
        abgeschlossen,
        abgeschlossenVon: abschlussMon.get(m)?.abgeschlossenVon ?? null,
        abgeschlossenAm: abschlussMon.get(m)?.abgeschlossenAm ?? null,
        notiz: abschlussMon.get(m)?.notiz ?? null,
        ampel,
      });
    }
    return { jahr, toleranzProzent: toleranz, monate };
  }

  /** Detail-Abgleich eines Monats je Region: GL-Ist vs Sales-Flash-Ist (EUR), Units, impliziter ASP, Budget. */
  async detail(jahr: number, monat: number) {
    const { toleranz } = await this.dashboard.istEinstellungen();
    const [ksts, regionen, glGrp, budGrp, absGrp] = await Promise.all([
      this.prisma.kostenstelle.findMany({ select: { id: true, regionCode: true } }),
      this.prisma.region.findMany({ where: { forecastRelevant: true }, select: { code: true, bezeichnung: true }, orderBy: { code: 'asc' } }),
      this.prisma.istUmsatz.groupBy({ by: ['kostenstelleId'], where: { jahr, monat: { lte: monat } }, _sum: { wertEur: true } }),
      this.prisma.budget.groupBy({ by: ['regionCode'], where: { jahr, status: 'AKTIV', monat: { not: null, lte: monat } }, _sum: { wertEur: true } }),
      this.prisma.absatz.groupBy({ by: ['regionCode'], where: { jahr, bisMonat: monat }, _sum: { seeds: true } }),
    ]);
    const regByKst = new Map(ksts.map((k) => [k.id, k.regionCode]));
    const glByRegion = new Map<string, number>();
    for (const g of glGrp) {
      const rc = regByKst.get(g.kostenstelleId);
      if (rc) glByRegion.set(rc, (glByRegion.get(rc) ?? 0) + Number(g._sum.wertEur ?? 0));
    }
    const budByRegion = new Map(budGrp.map((g) => [g.regionCode, Number(g._sum.wertEur ?? 0)]));
    const unitsByRegion = new Map<string, number>();
    for (const g of absGrp) if (g.regionCode) unitsByRegion.set(g.regionCode, Number(g._sum.seeds ?? 0));
    const sfByRegion = await this.dashboard.salesFlashIstProRegion(jahr, null);

    const zeilen = regionen.map((r) => {
      const gl = glByRegion.get(r.code) ?? 0;
      const sf = sfByRegion.has(r.code) ? sfByRegion.get(r.code)! : null;
      const offiziell = sf ?? gl;
      const units = unitsByRegion.get(r.code) ?? null;
      const budget = budByRegion.get(r.code) ?? 0;
      const deltaEur = sf == null ? null : round2(sf - gl);
      const deltaProzent = deltaEur != null && gl !== 0 ? round2((deltaEur / Math.abs(gl)) * 100) : null;
      return {
        regionCode: r.code,
        bezeichnung: r.bezeichnung,
        glIst: round2(gl),
        salesFlashIst: sf == null ? null : round2(sf),
        offiziellIst: round2(offiziell),
        deltaEur,
        deltaProzent,
        imToleranz: deltaProzent == null ? null : Math.abs(deltaProzent) <= toleranz,
        units: units == null ? null : Math.round(units),
        aspEur: units && units !== 0 ? round2(offiziell / units) : null,
        budget: round2(budget),
        abwBudgetEur: round2(offiziell - budget),
        abwBudgetProzent: budget === 0 ? null : round2(((offiziell - budget) / Math.abs(budget)) * 100),
      };
    });
    const sumNum = (sel: (z: (typeof zeilen)[number]) => number): number => round2(zeilen.reduce((s, z) => s + sel(z), 0));
    const glGesamt = sumNum((z) => z.glIst);
    const offGesamt = sumNum((z) => z.offiziellIst);
    const unitsGesamt = zeilen.reduce((s, z) => s + (z.units ?? 0), 0);
    return {
      jahr,
      monat,
      toleranzProzent: toleranz,
      zeilen,
      gesamt: {
        glIst: glGesamt,
        salesFlashIst: zeilen.some((z) => z.salesFlashIst != null) ? sumNum((z) => z.salesFlashIst ?? 0) : null,
        offiziellIst: offGesamt,
        deltaEur: round2(offGesamt - glGesamt),
        units: unitsGesamt,
        aspEur: unitsGesamt ? round2(offGesamt / unitsGesamt) : null,
        budget: sumNum((z) => z.budget),
        abwBudgetEur: sumNum((z) => z.abwBudgetEur),
      },
    };
  }

  async abschliessen(jahr: number, monat: number, notiz: string | null, aktor: RequestUser) {
    const result = await this.prisma.periodenAbschluss.upsert({
      where: { jahr_monat: { jahr, monat } },
      update: { abgeschlossen: true, abgeschlossenVon: aktor.email, abgeschlossenAm: new Date(), notiz },
      create: { jahr, monat, abgeschlossen: true, abgeschlossenVon: aktor.email, abgeschlossenAm: new Date(), notiz },
    });
    await this.audit.write({ entitaet: 'PeriodenAbschluss', entitaetId: result.id, aktion: 'STATUS_WECHSEL', userId: aktor.id, userEmail: aktor.email, nachherWert: { jahr, monat, abgeschlossen: true } });
    return { jahr, monat, abgeschlossen: true };
  }

  async wiederOeffnen(jahr: number, monat: number, aktor: RequestUser) {
    const vorhanden = await this.prisma.periodenAbschluss.findUnique({ where: { jahr_monat: { jahr, monat } } });
    if (!vorhanden) return { jahr, monat, abgeschlossen: false };
    const result = await this.prisma.periodenAbschluss.update({ where: { id: vorhanden.id }, data: { abgeschlossen: false, abgeschlossenVon: null, abgeschlossenAm: null } });
    await this.audit.write({ entitaet: 'PeriodenAbschluss', entitaetId: result.id, aktion: 'STATUS_WECHSEL', userId: aktor.id, userEmail: aktor.email, nachherWert: { jahr, monat, abgeschlossen: false } });
    return { jahr, monat, abgeschlossen: false };
  }
}
