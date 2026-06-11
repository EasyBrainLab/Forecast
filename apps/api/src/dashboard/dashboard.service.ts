import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatPeriode, type MonatswerteRest } from '@forecast/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../scope/scope.service';
import type { Scope } from '../scope/scope.types';
import type { RequestUser } from '../common/decorators/current-user.decorator';

const round2 = (x: number): number => Math.round(x * 100) / 100;
const sumMw = (mw: MonatswerteRest): number => Object.values(mw).reduce((s, x) => s + (x?.eur ?? 0), 0);

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  /** Einzelbuchung als Sondereffekt markieren (BU-Leiter). Steuert die bereinigte Sicht. */
  async markSondereffekt(recid: string, istSondereffekt: boolean, grund: string | null, aktor: RequestUser) {
    await this.prisma.istUmsatz.update({ where: { recid }, data: { istSondereffekt, sondereffektGrund: grund } });
    await this.audit.write({ entitaet: 'IstUmsatz', entitaetId: recid, aktion: 'UPDATE', userId: aktor.id, userEmail: aktor.email, nachherWert: { istSondereffekt, grund } });
    return { recid, istSondereffekt };
  }

  private stichtag(jahr: number): { aktJahr: number; aktMonat: number; istGrenze: number } {
    const now = new Date();
    const aktJahr = now.getUTCFullYear();
    const aktMonat = now.getUTCMonth() + 1;
    // Monate < istGrenze gelten als Ist
    const istGrenze = jahr < aktJahr ? 13 : jahr > aktJahr ? 0 : aktMonat;
    return { aktJahr, aktMonat, istGrenze };
  }

  /** Konsolidierte Sicht je Region + BU-Gesamt: Ist YTD, Forecast-Rest, YEE, Budget, Abweichung. */
  async konsolidierung(jahr: number, aktor: RequestUser, bereinigt = false) {
    const scope = await this.scope.getScope(aktor);
    const { aktJahr, aktMonat, istGrenze } = this.stichtag(jahr);

    const ksts = await this.prisma.kostenstelle.findMany({ select: { id: true, regionCode: true } });
    const regByKst = new Map(ksts.map((k) => [k.id, k.regionCode]));
    const erlaubteKst = scope.unbeschraenkt ? null : new Set(scope.kostenstelleIds);

    const istWhere: Prisma.IstUmsatzWhereInput = { jahr, monat: { lt: istGrenze } };
    if (bereinigt) istWhere.istSondereffekt = false;
    if (erlaubteKst) istWhere.kostenstelleId = { in: [...erlaubteKst] };
    const istGrp = await this.prisma.istUmsatz.groupBy({ by: ['kostenstelleId'], where: istWhere, _sum: { wertEur: true } });
    const istByRegion = new Map<string, number>();
    for (const g of istGrp) {
      const rc = regByKst.get(g.kostenstelleId);
      if (rc) istByRegion.set(rc, (istByRegion.get(rc) ?? 0) + Number(g._sum.wertEur ?? 0));
    }

    const budWhere: Prisma.BudgetWhereInput = { jahr, status: 'AKTIV' };
    if (!scope.unbeschraenkt) budWhere.regionCode = { in: scope.regionCodes.length ? scope.regionCodes : ['__none__'] };
    const budGrp = await this.prisma.budget.groupBy({ by: ['regionCode'], where: budWhere, _sum: { wertEur: true } });
    const budByRegion = new Map(budGrp.map((g) => [g.regionCode, Number(g._sum.wertEur ?? 0)]));

    const fcByRegion = await this.forecastRestProRegion(jahr, scope);

    const regionen = await this.prisma.region.findMany({
      where: { forecastRelevant: true, ...(scope.unbeschraenkt ? {} : { code: { in: scope.regionCodes.length ? scope.regionCodes : ['__none__'] } }) },
      orderBy: { code: 'asc' },
    });

    const zeilen = regionen.map((r) => {
      const ist = istByRegion.get(r.code) ?? 0;
      const fc = fcByRegion.get(r.code) ?? 0;
      const yee = ist + fc;
      const budget = budByRegion.get(r.code) ?? 0;
      return {
        regionCode: r.code,
        bezeichnung: r.bezeichnung,
        istYtd: round2(ist),
        forecastRest: round2(fc),
        yee: round2(yee),
        budget: round2(budget),
        abweichungEur: round2(yee - budget),
        abweichungProzent: budget === 0 ? null : round2(((yee - budget) / Math.abs(budget)) * 100),
      };
    });
    const sum = (sel: 'istYtd' | 'forecastRest' | 'yee' | 'budget' | 'abweichungEur'): number => round2(zeilen.reduce((s, z) => s + z[sel], 0));
    return {
      jahr,
      stichtag: formatPeriode(aktJahr, aktMonat),
      bereinigt,
      zeilen,
      gesamt: { istYtd: sum('istYtd'), forecastRest: sum('forecastRest'), yee: sum('yee'), budget: sum('budget'), abweichungEur: sum('abweichungEur') },
    };
  }

  private async forecastRestProRegion(jahr: number, scope: Scope): Promise<Map<string, number>> {
    const where: Prisma.ForecastVersionWhereInput = { jahr };
    if (!scope.unbeschraenkt) where.regionCode = { in: scope.regionCodes.length ? scope.regionCodes : ['__none__'] };
    const versionen = await this.prisma.forecastVersion.findMany({ where, orderBy: { version: 'desc' } });
    // pro Region: jüngste Periode; darin jüngste Version je Zelle
    const proRegion = new Map<string, number>();
    const byRegion = new Map<string, typeof versionen>();
    for (const v of versionen) {
      const arr = byRegion.get(v.regionCode) ?? [];
      arr.push(v);
      byRegion.set(v.regionCode, arr);
    }
    for (const [region, vs] of byRegion) {
      const maxPeriode = vs.reduce((m, v) => (v.periode > m ? v.periode : m), vs[0]?.periode ?? '');
      const seen = new Set<string>();
      let summe = 0;
      for (const v of vs) {
        if (v.periode !== maxPeriode) continue;
        const k = `${v.landId}|${v.e1Id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        summe += sumMw(v.monatswerteRest as unknown as MonatswerteRest);
      }
      proRegion.set(region, summe);
    }
    return proRegion;
  }

  /** Drill-down: Region → Land → E1 → E2; ohne Filter aggregiert über alle Regionen. */
  async drilldown(jahr: number, aktor: RequestUser, filter: { regionCode?: string; landId?: string; e1Id?: string }) {
    const scope = await this.scope.getScope(aktor);
    const istWhere: Prisma.IstUmsatzWhereInput = { jahr };
    if (!scope.unbeschraenkt) istWhere.kostenstelleId = { in: scope.kostenstelleIds.length ? scope.kostenstelleIds : ['__none__'] };
    if (filter.landId) istWhere.landId = filter.landId;
    if (filter.e1Id) istWhere.e1Id = filter.e1Id;
    if (filter.regionCode) {
      const ksts = await this.prisma.kostenstelle.findMany({ where: { regionCode: filter.regionCode }, select: { id: true } });
      istWhere.kostenstelleId = { in: ksts.map((k) => k.id) };
    }
    if (filter.e1Id) {
      const grp = await this.prisma.istUmsatz.groupBy({ by: ['e2Id'], where: istWhere, _sum: { wertEur: true } });
      return { ebene: 'E2', zeilen: grp.map((g) => ({ key: g.e2Id, summeEur: round2(Number(g._sum.wertEur ?? 0)) })) };
    }
    if (filter.landId || filter.regionCode) {
      const grp = await this.prisma.istUmsatz.groupBy({ by: ['e1Id'], where: istWhere, _sum: { wertEur: true } });
      return { ebene: 'E1', zeilen: grp.map((g) => ({ key: g.e1Id, summeEur: round2(Number(g._sum.wertEur ?? 0)) })) };
    }
    const grp = await this.prisma.istUmsatz.groupBy({ by: ['landId'], where: istWhere, _sum: { wertEur: true } });
    return { ebene: 'LAND', zeilen: grp.map((g) => ({ key: g.landId, summeEur: round2(Number(g._sum.wertEur ?? 0)) })) };
  }

  /** Einzelbuchungen (RECID-Ebene), scoped. */
  async einzelbuchungen(jahr: number, aktor: RequestUser, filter: { landId?: string; e1Id?: string; e2Id?: string }) {
    const scope = await this.scope.getScope(aktor);
    const where: Prisma.IstUmsatzWhereInput = { jahr, ...filter };
    if (!scope.unbeschraenkt) where.kostenstelleId = { in: scope.kostenstelleIds.length ? scope.kostenstelleIds : ['__none__'] };
    return this.prisma.istUmsatz.findMany({ where, take: 500, orderBy: { buchungsdatum: 'desc' } });
  }
}
