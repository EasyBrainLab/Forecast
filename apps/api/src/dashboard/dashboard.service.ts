import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EINSTELLUNG_KEYS, formatPeriode, type MonatswerteRest } from '@forecast/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../scope/scope.service';
import type { Scope } from '../scope/scope.types';
import type { RequestUser } from '../common/decorators/current-user.decorator';

const round2 = (x: number): number => Math.round(x * 100) / 100;

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

  /** Maßgebliche Ist-Quelle + Abgleich-Toleranz aus den Einstellungen (Default: Sales Flash, 2 %). */
  async istEinstellungen(): Promise<{ quelle: 'SALES_FLASH' | 'GL'; toleranz: number }> {
    const [q, t] = await Promise.all([
      this.prisma.einstellung.findUnique({ where: { key: EINSTELLUNG_KEYS.IST_QUELLE } }),
      this.prisma.einstellung.findUnique({ where: { key: EINSTELLUNG_KEYS.ABGLEICH_TOLERANZ_PROZENT } }),
    ]);
    return { quelle: q?.value === 'GL' ? 'GL' : 'SALES_FLASH', toleranz: Number(t?.value ?? 2) };
  }

  /**
   * Verifiziertes Sales-Flash-Ist je Region (scoped). Wählt den jüngsten Beleg mit Monat <= zielMonat UND
   * nicht-leeren Actuals, damit der kumulierte SF-Zeitraum (Jan..Belegmonat) nicht über die GL-Ist-Periode
   * (Jan..zielMonat) hinausläuft und ein unparsbarer jüngerer Beleg keinen erfassten älteren verdeckt.
   * Leere Map, wenn kein passender Beleg -> Fallback auf GL.
   */
  async salesFlashIstProRegion(jahr: number, regionCodes: string[] | null, zielMonat: number): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (zielMonat < 1) return out;
    const docs = await this.prisma.salesFlashDokument.findMany({ where: { jahr, monat: { lte: zielMonat } }, orderBy: { monat: 'desc' }, select: { actuals: true } });
    const passend = docs.find((d) => {
      const a = d.actuals as unknown as { regionen?: { regionCode: string; eur: number }[] };
      return (a?.regionen?.length ?? 0) > 0;
    });
    if (!passend) return out;
    const actuals = passend.actuals as unknown as { regionen?: { regionCode: string; eur: number }[] };
    for (const r of actuals?.regionen ?? []) {
      if (regionCodes && !regionCodes.includes(r.regionCode)) continue;
      out.set(r.regionCode, Number(r.eur));
    }
    return out;
  }

  /** zielMonat (letzter Ist-Monat) aus der Ist-Grenze: laufendes Jahr -> istGrenze-1, Vorjahr -> 12, Zukunft -> 0. */
  private zielMonat(istGrenze: number): number {
    return istGrenze >= 13 ? 12 : istGrenze - 1;
  }

  /** Offizielle Ist-EUR je Region: Sales-Flash wo vorhanden, sonst GL (außer im bereinigten Modus -> immer GL). */
  private async offizielleIst(jahr: number, glIstByRegion: Map<string, number>, scope: Scope, bereinigt: boolean, istGrenze: number): Promise<{ ist: Map<string, number>; quelleProRegion: Map<string, 'SALES_FLASH' | 'GL'>; quelle: 'SALES_FLASH' | 'GL' }> {
    const { quelle } = await this.istEinstellungen();
    const out = new Map(glIstByRegion);
    const quelleProRegion = new Map<string, 'SALES_FLASH' | 'GL'>([...glIstByRegion.keys()].map((k) => [k, 'GL' as const]));
    if (quelle !== 'SALES_FLASH' || bereinigt) return { ist: out, quelleProRegion, quelle };
    const sf = await this.salesFlashIstProRegion(jahr, scope.unbeschraenkt ? null : scope.regionCodes, this.zielMonat(istGrenze));
    for (const [code, eur] of sf) {
      out.set(code, eur);
      quelleProRegion.set(code, 'SALES_FLASH');
    }
    return { ist: out, quelleProRegion, quelle };
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

    const fcByRegion = await this.forecastRestProRegion(jahr, scope, istGrenze);
    const { ist: istOffiziell, quelleProRegion, quelle: istQuelle } = await this.offizielleIst(jahr, istByRegion, scope, bereinigt, istGrenze);

    const regionen = await this.prisma.region.findMany({
      where: { forecastRelevant: true, ...(scope.unbeschraenkt ? {} : { code: { in: scope.regionCodes.length ? scope.regionCodes : ['__none__'] } }) },
      orderBy: { code: 'asc' },
    });

    const zeilen = regionen.map((r) => {
      const ist = istOffiziell.get(r.code) ?? 0;
      const fc = fcByRegion.get(r.code) ?? 0;
      const yee = ist + fc;
      const budget = budByRegion.get(r.code) ?? 0;
      return {
        regionCode: r.code,
        bezeichnung: r.bezeichnung,
        istYtd: round2(ist),
        istQuelle: quelleProRegion.get(r.code) ?? 'GL',
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
      istQuelle,
      zeilen,
      gesamt: { istYtd: sum('istYtd'), forecastRest: sum('forecastRest'), yee: sum('yee'), budget: sum('budget'), abweichungEur: sum('abweichungEur') },
    };
  }

  /**
   * Konsolidierte Monatssicht je Produktgruppe (E1) über alle Regionen im Scope, im Format der
   * Forecast-Monatsansicht: Ist je Monat (< istGrenze), Forecast je Monat (>= istGrenze) und Budget
   * je Monat. Werte in vollem EUR (Anzeige rechnet in kEUR). Forecast wird — wie in der bestehenden
   * Konsolidierung — aus der jüngsten Periode/Version je Zelle (Land×E1) summiert (kein Budget-
   * Fallback), sodass die Summen zur Region-Konsolidierung passen.
   */
  async konsolidierungMonatlich(jahr: number, aktor: RequestUser) {
    const scope = await this.scope.getScope(aktor);
    const { aktJahr, aktMonat, istGrenze } = this.stichtag(jahr);
    const monate = Array.from({ length: 12 }, (_, i) => formatPeriode(jahr, i + 1));

    const e1s = await this.prisma.produktgruppeE1.findMany({
      orderBy: { sortierung: 'asc' },
      select: { id: true, nameDe: true },
    });

    const istWhere: Prisma.IstUmsatzWhereInput = { jahr, monat: { lt: istGrenze } };
    if (!scope.unbeschraenkt) {
      istWhere.kostenstelleId = { in: scope.kostenstelleIds.length ? scope.kostenstelleIds : ['__none__'] };
    }
    const budWhere: Prisma.BudgetWhereInput = { jahr, status: 'AKTIV', monat: { not: null } };
    if (!scope.unbeschraenkt) {
      budWhere.regionCode = { in: scope.regionCodes.length ? scope.regionCodes : ['__none__'] };
    }
    const fcWhere: Prisma.ForecastVersionWhereInput = { jahr };
    if (!scope.unbeschraenkt) {
      fcWhere.regionCode = { in: scope.regionCodes.length ? scope.regionCodes : ['__none__'] };
    }

    const [istGrp, budGrp, versionen] = await Promise.all([
      this.prisma.istUmsatz.groupBy({ by: ['e1Id', 'monat'], where: istWhere, _sum: { wertEur: true } }),
      this.prisma.budget.groupBy({ by: ['e1Id', 'monat'], where: budWhere, _sum: { wertEur: true } }),
      this.prisma.forecastVersion.findMany({ where: fcWhere, orderBy: { version: 'desc' } }),
    ]);

    // Ist/Budget je E1 je Monat.
    const istMap = new Map<string, Record<string, number>>();
    for (const g of istGrp) {
      const rec = istMap.get(g.e1Id) ?? {};
      rec[formatPeriode(jahr, g.monat)] = Number(g._sum.wertEur ?? 0);
      istMap.set(g.e1Id, rec);
    }
    const budMap = new Map<string, Record<string, number>>();
    for (const g of budGrp) {
      if (g.monat == null) continue;
      const rec = budMap.get(g.e1Id) ?? {};
      rec[formatPeriode(jahr, g.monat)] = Number(g._sum.wertEur ?? 0);
      budMap.set(g.e1Id, rec);
    }

    // Forecast je E1 je Monat: pro Region jüngste Periode, darin jüngste Version je Zelle, nur Monate >= istGrenze.
    const byRegion = new Map<string, typeof versionen>();
    for (const v of versionen) {
      const arr = byRegion.get(v.regionCode) ?? [];
      arr.push(v);
      byRegion.set(v.regionCode, arr);
    }
    const fcMap = new Map<string, Record<string, number>>();
    for (const [, vs] of byRegion) {
      const maxPeriode = vs.reduce((m, v) => (v.periode > m ? v.periode : m), vs[0]?.periode ?? '');
      const seen = new Set<string>();
      for (const v of vs) {
        if (v.periode !== maxPeriode) continue;
        const cellKey = `${v.landId}|${v.e1Id}`;
        if (seen.has(cellKey)) continue;
        seen.add(cellKey);
        const rec = fcMap.get(v.e1Id) ?? {};
        for (const [periode, val] of Object.entries((v.monatswerteRest ?? {}) as unknown as MonatswerteRest)) {
          if (Number(periode.slice(5, 7)) < istGrenze) continue; // nur Forecast-Monate
          rec[periode] = (rec[periode] ?? 0) + (val?.eur ?? 0);
        }
        fcMap.set(v.e1Id, rec);
      }
    }

    const zeilen = e1s.map((e) => ({
      e1Id: e.id,
      bezeichnung: e.nameDe,
      istMonate: istMap.get(e.id) ?? {},
      forecastMonate: fcMap.get(e.id) ?? {},
      budgetMonate: budMap.get(e.id) ?? {},
    }));

    return {
      jahr,
      stichtag: formatPeriode(aktJahr, aktMonat),
      monate,
      restAbMonat: istGrenze, // Monate mit Nummer >= restAbMonat sind Forecast, < sind Ist
      zeilen,
    };
  }

  /** Summiert nur die monatswerteRest-Einträge, die am Stichtag noch Forecast sind (Monat >= istGrenze) — verhindert Überlappung mit dem Ist-YTD. */
  private summeForecastAbGrenze(mw: MonatswerteRest, istGrenze: number): number {
    return Object.entries(mw).reduce((s, [periode, val]) => {
      const m = Number(periode.slice(5, 7));
      return m >= istGrenze ? s + (val?.eur ?? 0) : s;
    }, 0);
  }

  private async forecastRestProRegion(jahr: number, scope: Scope, istGrenze: number): Promise<Map<string, number>> {
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
        summe += this.summeForecastAbGrenze(v.monatswerteRest as unknown as MonatswerteRest, istGrenze);
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

  // ─────────────── KPI-Bündel für die grafische Übersicht ───────────────
  async kpi(jahr: number, aktor: RequestUser) {
    const scope = await this.scope.getScope(aktor);
    const st = this.stichtag(jahr);
    const kstFilter: Prisma.IstUmsatzWhereInput = scope.unbeschraenkt ? {} : { kostenstelleId: { in: scope.kostenstelleIds.length ? scope.kostenstelleIds : ['__none__'] } };

    const [ksts, regionen, e1s, laender] = await Promise.all([
      this.prisma.kostenstelle.findMany({ select: { id: true, regionCode: true } }),
      this.prisma.region.findMany({ where: { forecastRelevant: true }, select: { code: true, bezeichnung: true } }),
      this.prisma.produktgruppeE1.findMany({ select: { id: true, nameDe: true } }),
      this.prisma.land.findMany({ select: { isoCode: true, nameDe: true } }),
    ]);
    const regByKst = new Map(ksts.map((k) => [k.id, k.regionCode]));
    const e1Name = new Map(e1s.map((e) => [e.id, e.nameDe]));
    const landName = new Map(laender.map((l) => [l.isoCode, l.nameDe]));
    const regBez = new Map(regionen.map((r) => [r.code, r.bezeichnung]));
    const forecastRelevant = new Set(regionen.map((r) => r.code));
    // Für den YoY-/Headline-GL-Vergleich nur forecast-relevante Kostenstellen (ohne ZENTRAL) — konsistent zur SF-Headline.
    const frKstIds = ksts.filter((k) => forecastRelevant.has(k.regionCode) && (scope.unbeschraenkt || scope.kostenstelleIds.includes(k.id))).map((k) => k.id);
    const frFilter: Prisma.IstUmsatzWhereInput = { kostenstelleId: { in: frKstIds.length ? frKstIds : ['__none__'] } };

    const budScope: Prisma.BudgetWhereInput = scope.unbeschraenkt ? {} : { regionCode: { in: scope.regionCodes.length ? scope.regionCodes : ['__none__'] } };
    const [monGrp, monGrpVor, istKstGrp, e1Grp, landGrp, istYtdAgg, vorjahrYtdAgg, budMonGrp] = await Promise.all([
      this.prisma.istUmsatz.groupBy({ by: ['monat'], where: { jahr, ...kstFilter }, _sum: { wertEur: true } }),
      this.prisma.istUmsatz.groupBy({ by: ['monat'], where: { jahr: jahr - 1, ...kstFilter }, _sum: { wertEur: true } }),
      this.prisma.istUmsatz.groupBy({ by: ['kostenstelleId'], where: { jahr, ...kstFilter }, _sum: { wertEur: true } }),
      this.prisma.istUmsatz.groupBy({ by: ['e1Id'], where: { jahr, ...kstFilter }, _sum: { wertEur: true } }),
      this.prisma.istUmsatz.groupBy({ by: ['landId'], where: { jahr, ...kstFilter }, _sum: { wertEur: true } }),
      this.prisma.istUmsatz.aggregate({ where: { jahr, monat: { lt: st.istGrenze }, ...frFilter }, _sum: { wertEur: true } }),
      this.prisma.istUmsatz.aggregate({ where: { jahr: jahr - 1, monat: { lt: st.istGrenze }, ...frFilter }, _sum: { wertEur: true } }),
      this.prisma.budget.groupBy({ by: ['monat'], where: { jahr, status: 'AKTIV', monat: { not: null }, ...budScope }, _sum: { wertEur: true } }),
    ]);

    const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
    const monMap = new Map(monGrp.map((g) => [g.monat, Number(g._sum.wertEur ?? 0)]));
    const monMapVor = new Map(monGrpVor.map((g) => [g.monat, Number(g._sum.wertEur ?? 0)]));
    const budMonMap = new Map(budMonGrp.map((g) => [g.monat, Number(g._sum.wertEur ?? 0)]));
    const umsatzProMonat = MON.map((m, i) => ({
      monat: m,
      ist: round2(monMap.get(i + 1) ?? 0),
      vorjahr: round2(monMapVor.get(i + 1) ?? 0),
      budget: round2(budMonMap.get(i + 1) ?? 0),
    }));

    const istByRegion = new Map<string, number>();
    for (const g of istKstGrp) {
      const rc = regByKst.get(g.kostenstelleId);
      if (rc) istByRegion.set(rc, (istByRegion.get(rc) ?? 0) + Number(g._sum.wertEur ?? 0));
    }
    // Offizielle Ist-EUR je Region (Sales Flash wo vorhanden, sonst GL)
    const { ist: istOffiziell, quelle: istQuelle } = await this.offizielleIst(jahr, istByRegion, scope, false, st.istGrenze);
    const umsatzProRegion = [...istOffiziell.entries()]
      .filter(([rc]) => forecastRelevant.has(rc))
      .map(([rc, v]) => ({ regionCode: rc, bezeichnung: regBez.get(rc) ?? rc, ist: round2(v) }))
      .sort((a, b) => b.ist - a.ist);
    const umsatzProProduktgruppe = e1Grp
      .map((g) => ({ produktgruppe: e1Name.get(g.e1Id) ?? g.e1Id, ist: round2(Number(g._sum.wertEur ?? 0)) }))
      .filter((x) => x.ist !== 0)
      .sort((a, b) => b.ist - a.ist);
    const topLaender = landGrp
      .map((g) => ({ land: g.landId ? (landName.get(g.landId) ?? g.landId) : 'Unbekannt', ist: round2(Number(g._sum.wertEur ?? 0)) }))
      .sort((a, b) => b.ist - a.ist)
      .slice(0, 10);

    const budWhere: Prisma.BudgetWhereInput = { jahr, status: 'AKTIV', ...(scope.unbeschraenkt ? {} : { regionCode: { in: scope.regionCodes.length ? scope.regionCodes : ['__none__'] } }) };
    const budGrp = await this.prisma.budget.groupBy({ by: ['regionCode'], where: budWhere, _sum: { wertEur: true } });
    const budByRegion = new Map(budGrp.map((g) => [g.regionCode, Number(g._sum.wertEur ?? 0)]));
    const fcByRegion = await this.forecastRestProRegion(jahr, scope, st.istGrenze);

    const istVsBudgetVsForecast = umsatzProRegion.map((r) => ({
      regionCode: r.regionCode,
      bezeichnung: r.bezeichnung,
      ist: round2(istOffiziell.get(r.regionCode) ?? 0),
      budget: round2(budByRegion.get(r.regionCode) ?? 0),
      forecast: round2(fcByRegion.get(r.regionCode) ?? 0),
    }));

    // Headline-Ist = offizielle Quelle (Sales Flash) über forecast-relevante Regionen; YoY bleibt GL-konsistent.
    const istYtd = [...istOffiziell.entries()].filter(([rc]) => forecastRelevant.has(rc)).reduce((s, [, v]) => s + v, 0);
    const istYtdGL = Number(istYtdAgg._sum.wertEur ?? 0);
    const vorjahrYtd = Number(vorjahrYtdAgg._sum.wertEur ?? 0);
    const budgetGesamt = [...budByRegion.values()].reduce((s, v) => s + v, 0);
    const forecastGesamt = [...fcByRegion.values()].reduce((s, v) => s + v, 0);
    const yee = istYtd + forecastGesamt;
    const abweichungProzent = budgetGesamt === 0 ? null : round2(((yee - budgetGesamt) / Math.abs(budgetGesamt)) * 100);
    const yoyProzent = vorjahrYtd === 0 ? null : round2(((istYtdGL - vorjahrYtd) / Math.abs(vorjahrYtd)) * 100);

    return {
      jahr,
      stichtag: formatPeriode(st.aktJahr, st.aktMonat),
      istQuelle,
      kennzahlen: { istYtd: round2(istYtd), istYtdGL: round2(istYtdGL), budget: round2(budgetGesamt), yee: round2(yee), abweichungProzent, vorjahrYtd: round2(vorjahrYtd), yoyProzent },
      umsatzProMonat,
      umsatzProRegion,
      umsatzProProduktgruppe,
      topLaender,
      istVsBudgetVsForecast,
    };
  }

  // ─────────────── Rohdaten-Browser (paginiert, scoped) ───────────────
  async istDaten(jahr: number, aktor: RequestUser, filter: { regionCode?: string; landId?: string; e1Id?: string }, page = 1, pageSize = 50) {
    const scope = await this.scope.getScope(aktor);
    const ps = Math.min(Math.max(pageSize, 1), 200);
    const where: Prisma.IstUmsatzWhereInput = { jahr };
    if (filter.landId) where.landId = filter.landId;
    if (filter.e1Id) where.e1Id = filter.e1Id;
    let kstIds: string[] | null = scope.unbeschraenkt ? null : scope.kostenstelleIds;
    if (filter.regionCode) {
      const ksts = await this.prisma.kostenstelle.findMany({ where: { regionCode: filter.regionCode }, select: { id: true } });
      const ids = ksts.map((k) => k.id);
      kstIds = kstIds ? kstIds.filter((id) => ids.includes(id)) : ids;
    }
    if (kstIds) where.kostenstelleId = { in: kstIds.length ? kstIds : ['__none__'] };

    const [total, sumAgg, items] = await Promise.all([
      this.prisma.istUmsatz.count({ where }),
      this.prisma.istUmsatz.aggregate({ where, _sum: { wertEur: true } }),
      this.prisma.istUmsatz.findMany({
        where,
        orderBy: { buchungsdatum: 'desc' },
        skip: (page - 1) * ps,
        take: ps,
        include: { kostenstelle: { select: { regionCode: true, nummer: true } }, land: { select: { nameDe: true } }, e1: { select: { nameDe: true } }, e2: { select: { name: true } } },
      }),
    ]);
    return {
      page,
      pageSize: ps,
      total,
      summeEur: round2(Number(sumAgg._sum.wertEur ?? 0)),
      items: items.map((i) => ({
        recid: i.recid,
        buchungsdatum: i.buchungsdatum,
        jahr: i.jahr,
        monat: i.monat,
        regionCode: i.kostenstelle.regionCode,
        kostenstelle: i.kostenstelle.nummer,
        land: i.land?.nameDe ?? '—',
        produktgruppe: i.e1.nameDe,
        e2: i.e2?.name ?? '—',
        kostentraeger: i.kostentraeger ?? '—',
        wertEur: round2(Number(i.wertEur)),
        istSondereffekt: i.istSondereffekt,
      })),
    };
  }

  async budgetDaten(jahr: number, aktor: RequestUser, filter: { regionCode?: string }, page = 1, pageSize = 50) {
    const scope = await this.scope.getScope(aktor);
    const ps = Math.min(Math.max(pageSize, 1), 200);
    const where: Prisma.BudgetWhereInput = { jahr, status: 'AKTIV' };
    if (filter.regionCode) where.regionCode = filter.regionCode;
    if (!scope.unbeschraenkt) where.regionCode = { in: scope.regionCodes.length ? scope.regionCodes : ['__none__'] };

    const [total, sumAgg, items] = await Promise.all([
      this.prisma.budget.count({ where }),
      this.prisma.budget.aggregate({ where, _sum: { wertEur: true } }),
      this.prisma.budget.findMany({
        where,
        orderBy: [{ regionCode: 'asc' }, { monat: 'asc' }],
        skip: (page - 1) * ps,
        take: ps,
        include: { land: { select: { nameDe: true } }, e1: { select: { nameDe: true } }, e2: { select: { name: true } } },
      }),
    ]);
    return {
      page,
      pageSize: ps,
      total,
      summeEur: round2(Number(sumAgg._sum.wertEur ?? 0)),
      items: items.map((b) => ({
        id: b.id,
        jahr: b.jahr,
        monat: b.monat,
        regionCode: b.regionCode,
        land: b.istRegionsreserve ? 'Regionsreserve' : (b.land?.nameDe ?? '—'),
        produktgruppe: b.e1.nameDe,
        e2: b.e2?.name ?? '—',
        wertEur: b.wertEur === null ? null : round2(Number(b.wertEur)),
        units: b.units === null ? null : Number(b.units),
        version: b.version,
      })),
    };
  }

  /** "Was ist im System": Zeilen, Summen, Jahre, letzter Import. */
  async uebersicht(aktor: RequestUser) {
    const scope = await this.scope.getScope(aktor);
    const kstFilter: Prisma.IstUmsatzWhereInput = scope.unbeschraenkt ? {} : { kostenstelleId: { in: scope.kostenstelleIds.length ? scope.kostenstelleIds : ['__none__'] } };
    const [istCount, istSum, jahreGrp, budgetCount, letzterIst, letzterBudget] = await Promise.all([
      this.prisma.istUmsatz.count({ where: kstFilter }),
      this.prisma.istUmsatz.aggregate({ where: kstFilter, _sum: { wertEur: true } }),
      this.prisma.istUmsatz.groupBy({ by: ['jahr'], where: kstFilter, _count: { _all: true } }),
      this.prisma.budget.count({ where: { status: 'AKTIV' } }),
      this.prisma.importBatch.findFirst({ where: { typ: 'IST' }, orderBy: { erstelltAm: 'desc' } }),
      this.prisma.importBatch.findFirst({ where: { typ: 'BUDGET' }, orderBy: { erstelltAm: 'desc' } }),
    ]);
    return {
      ist: {
        zeilen: istCount,
        summeEur: round2(Number(istSum._sum.wertEur ?? 0)),
        jahre: jahreGrp.map((g) => ({ jahr: g.jahr, zeilen: g._count._all })).sort((a, b) => a.jahr - b.jahr),
        letzterImport: letzterIst ? { dateiname: letzterIst.dateiname, status: letzterIst.status, zeilenNeu: letzterIst.zeilenNeu, erstelltAm: letzterIst.erstelltAm } : null,
      },
      budget: {
        zeilen: budgetCount,
        letzterImport: letzterBudget ? { dateiname: letzterBudget.dateiname, status: letzterBudget.status, erstelltAm: letzterBudget.erstelltAm } : null,
      },
    };
  }
}
