import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ForecastStatus, Prisma } from '@prisma/client';
import {
  braucheKommentarGegen,
  EINSTELLUNG_KEYS,
  FORECAST_TRANSITIONS,
  formatPeriode,
  schwellwertVerletzt as istSchwellwertVerletzt,
  type MonatswerteRest,
} from '@forecast/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { infoMail } from '../mail/mail.templates';
import { ScopeService } from '../scope/scope.service';
import { StateMachineService } from '../workflow/state-machine.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { AnpassenDto } from './forecast.dto';

type Client = PrismaService | Prisma.TransactionClient;

function summeEur(mw: MonatswerteRest): number {
  return Object.values(mw).reduce((s, x) => s + (x?.eur ?? 0), 0);
}

@Injectable()
export class ForecastService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly scope: ScopeService,
    private readonly sm: StateMachineService,
    private readonly config: ConfigService,
  ) {}

  private restMonate(periode: string): { jahr: number; monat: number; monate: number[] } {
    const [y, m] = periode.split('-').map(Number);
    const monate: number[] = [];
    for (let i = m; i <= 12; i++) monate.push(i);
    return { jahr: y, monat: m, monate };
  }

  private async schwellwert(): Promise<number> {
    const e = await this.prisma.einstellung.findUnique({ where: { key: EINSTELLUNG_KEYS.SCHWELLWERT_PROZENT } });
    return Number(e?.value ?? 10);
  }

  /** Schwellwert je Einzelmonat (Forecast vs. Budget des jeweiligen Monats). */
  private async monatsSchwellwert(): Promise<number> {
    const e = await this.prisma.einstellung.findUnique({ where: { key: EINSTELLUNG_KEYS.MONATS_SCHWELLWERT_PROZENT } });
    return Number(e?.value ?? 5);
  }

  private async assertAgmRead(aktor: RequestUser, regionCode: string): Promise<void> {
    if (aktor.rolle !== 'AGM') return;
    const scope = await this.scope.getScope(aktor);
    if (!scope.crossSicht && !scope.regionCodes.includes(regionCode)) {
      throw new ForbiddenException('Kein Zugriff auf diese Region.');
    }
  }

  /** Öffnet eine Periode für eine Region (idempotent) und seedet OFFEN-Versionen aus dem Budget der Restmonate. */
  async oeffnePeriode(periode: string, regionCode: string, aktor: RequestUser): Promise<void> {
    const { jahr, monat, monate } = this.restMonate(periode);
    const deadlineTag = Number((await this.prisma.einstellung.findUnique({ where: { key: EINSTELLUNG_KEYS.DEADLINE_TAG } }))?.value ?? 10);
    const deadline = new Date(Date.UTC(jahr, monat - 1, deadlineTag));
    await this.prisma.forecastPeriode.upsert({
      where: { periode_regionCode: { periode, regionCode } },
      update: {},
      create: { periode, jahr, monat, regionCode, status: ForecastStatus.OFFEN, deadline, benachrichtigtAm: new Date() },
    });
    const vorhanden = await this.prisma.forecastVersion.count({ where: { periode, regionCode } });
    if (vorhanden === 0) {
      const cells = await this.budgetRestProCell(jahr, regionCode, monate);
      for (const [key, mw] of cells) {
        const [landId, e1Id] = key.split('|');
        await this.prisma.forecastVersion.create({
          data: { periode, jahr, monat, regionCode, landId, e1Id, monatswerteRest: mw as unknown as Prisma.InputJsonValue, status: ForecastStatus.OFFEN, version: 1, userId: aktor.id },
        });
      }
    }
  }

  private async budgetRestProCell(jahr: number, regionCode: string, monate: number[]): Promise<Map<string, MonatswerteRest>> {
    const budgets = await this.prisma.budget.findMany({
      where: { jahr, regionCode, monat: { in: monate }, status: 'AKTIV', istRegionsreserve: false, landId: { not: null } },
      select: { landId: true, e1Id: true, monat: true, wertEur: true, units: true },
    });
    const map = new Map<string, MonatswerteRest>();
    for (const b of budgets) {
      if (!b.landId || b.monat === null) continue;
      const key = `${b.landId}|${b.e1Id}`;
      const cell = map.get(key) ?? {};
      cell[formatPeriode(jahr, b.monat)] = { eur: Number(b.wertEur ?? 0), units: b.units === null ? null : Number(b.units) };
      map.set(key, cell);
    }
    return map;
  }

  private async latestVersionen(client: Client, periode: string, regionCode: string) {
    const all = await client.forecastVersion.findMany({ where: { periode, regionCode }, orderBy: { version: 'desc' } });
    const seen = new Set<string>();
    const latest: typeof all = [];
    for (const v of all) {
      const k = `${v.landId}|${v.e1Id}`;
      if (!seen.has(k)) {
        seen.add(k);
        latest.push(v);
      }
    }
    return latest;
  }

  private async ladePeriode(periode: string, regionCode: string) {
    const p = await this.prisma.forecastPeriode.findUnique({ where: { periode_regionCode: { periode, regionCode } } });
    if (!p) throw new NotFoundException('Periode/Region nicht gefunden.');
    return p;
  }

  private async assertSchreib(aktor: RequestUser, regionCode: string): Promise<void> {
    if (aktor.rolle === 'AGM') {
      const scope = await this.scope.getScope(aktor);
      this.scope.assertSchreibScope(scope, regionCode);
    }
  }

  /** F1: OFFEN -> BESTAETIGT (AGM, Ein-Klick). */
  async bestaetigen(periode: string, regionCode: string, aktor: RequestUser) {
    const p = await this.ladePeriode(periode, regionCode);
    await this.assertSchreib(aktor, regionCode);
    this.sm.pruefe(FORECAST_TRANSITIONS, p.status, ForecastStatus.BESTAETIGT, { rolle: aktor.rolle, aktorId: aktor.id });
    await this.prisma.$transaction(async (tx) => {
      await this.neueVersionen(tx, periode, regionCode, ForecastStatus.BESTAETIGT, aktor);
      await tx.forecastPeriode.update({ where: { id: p.id }, data: { status: ForecastStatus.BESTAETIGT } });
      await this.audit.write({ entitaet: 'ForecastPeriode', entitaetId: p.id, aktion: 'STATUS_WECHSEL', userId: aktor.id, userEmail: aktor.email, nachherWert: { status: 'BESTAETIGT' } }, tx);
    });
    return { status: ForecastStatus.BESTAETIGT };
  }

  /** F2: OFFEN -> ANGEPASST (AGM, Pflichtkommentar bei Schwellwert). */
  async anpassen(periode: string, regionCode: string, aktor: RequestUser, dto: AnpassenDto) {
    const p = await this.ladePeriode(periode, regionCode);
    await this.assertSchreib(aktor, regionCode);
    const { jahr, monate } = this.restMonate(periode);
    const budgetCells = await this.budgetRestProCell(jahr, regionCode, monate);
    const schwelle = await this.schwellwert();
    const monatsSchwelle = await this.monatsSchwellwert();

    // Per-Monats-Pflichtkommentar (nur Monatssicht): jeder Monat, dessen Forecast den Monats-Schwellwert
    // (Default 5 %) gegen das Budget dieses Monats überschreitet, braucht eine Erklärung.
    const fehlendeMonatsKommentare: string[] = [];
    if (dto.monatsModus) for (const z of dto.zellen) {
      const key = `${z.landId}|${z.e1Id}`;
      const budgetMw = budgetCells.get(key);
      for (const [m, w] of Object.entries(z.monatswerteRest)) {
        const budgetMonat = budgetMw?.[m]?.eur ?? 0;
        if (braucheKommentarGegen(w.eur ?? 0, budgetMonat, monatsSchwelle) && !w.kommentar?.trim()) {
          fehlendeMonatsKommentare.push(`${z.e1Id}/${z.landId} ${m}`);
        }
      }
    }
    if (fehlendeMonatsKommentare.length > 0) {
      throw new BadRequestException(
        `Pflichtkommentar fehlt für Monate mit Abweichung > ${monatsSchwelle} %: ${fehlendeMonatsKommentare.join(', ')}`,
      );
    }

    let irgendVerletzt = false;
    const adjust = new Map<string, { mw: MonatswerteRest; verletzt: boolean }>();
    for (const z of dto.zellen) {
      const key = `${z.landId}|${z.e1Id}`;
      const neuSumme = summeEur(z.monatswerteRest);
      const budgetSumme = budgetCells.has(key) ? summeEur(budgetCells.get(key) as MonatswerteRest) : null;
      const verletzt = istSchwellwertVerletzt(neuSumme, { budget: budgetSumme }, schwelle);
      if (verletzt) irgendVerletzt = true;
      adjust.set(key, { mw: z.monatswerteRest, verletzt });
    }

    this.sm.pruefe(FORECAST_TRANSITIONS, p.status, ForecastStatus.ANGEPASST, {
      rolle: aktor.rolle,
      aktorId: aktor.id,
      kommentarErforderlich: irgendVerletzt,
      kommentar: dto.kommentar,
    });

    await this.prisma.$transaction(async (tx) => {
      await this.neueVersionen(tx, periode, regionCode, ForecastStatus.ANGEPASST, aktor, adjust, dto.kommentar);
      await tx.forecastPeriode.update({ where: { id: p.id }, data: { status: ForecastStatus.ANGEPASST } });
      await this.audit.write({ entitaet: 'ForecastPeriode', entitaetId: p.id, aktion: 'STATUS_WECHSEL', userId: aktor.id, userEmail: aktor.email, nachherWert: { status: 'ANGEPASST', schwellwertVerletzt: irgendVerletzt } }, tx);
    });
    return { status: ForecastStatus.ANGEPASST, schwellwertVerletzt: irgendVerletzt };
  }

  /** F3/F4 -> ZURUECKGEWIESEN, dann F5 (SYSTEM) -> OFFEN. */
  async zurueckweisen(periode: string, regionCode: string, aktor: RequestUser, begruendung: string) {
    const p = await this.ladePeriode(periode, regionCode);
    this.sm.pruefe(FORECAST_TRANSITIONS, p.status, ForecastStatus.ZURUECKGEWIESEN, { rolle: aktor.rolle, aktorId: aktor.id, begruendung });
    await this.prisma.$transaction(async (tx) => {
      await this.neueVersionen(tx, periode, regionCode, ForecastStatus.ZURUECKGEWIESEN, aktor, undefined, begruendung);
      await this.neueVersionen(tx, periode, regionCode, ForecastStatus.OFFEN, aktor);
      await tx.forecastPeriode.update({ where: { id: p.id }, data: { status: ForecastStatus.OFFEN } });
      await this.audit.write({ entitaet: 'ForecastPeriode', entitaetId: p.id, aktion: 'STATUS_WECHSEL', userId: aktor.id, userEmail: aktor.email, vorherWert: { status: p.status }, nachherWert: { status: 'ZURUECKGEWIESEN→OFFEN', begruendung } }, tx);
    });
    const agms = await this.aktiveAgms(regionCode);
    await Promise.all(agms.map((e) => this.mail.send(e, infoMail('Forecast zurückgewiesen', 'Bitte überarbeiten', `Region ${regionCode}, Periode ${periode}. Begründung: ${begruendung}`))));
    return { status: ForecastStatus.OFFEN };
  }

  /** F6/F7/F8 (SYSTEM, Monatsabschluss) -> ABGESCHLOSSEN. */
  async abschliessen(periode: string, regionCode: string, aktor: RequestUser) {
    const p = await this.ladePeriode(periode, regionCode);
    this.sm.pruefe(FORECAST_TRANSITIONS, p.status, ForecastStatus.ABGESCHLOSSEN, { rolle: aktor.rolle, aktorId: aktor.id, system: true });
    await this.prisma.$transaction(async (tx) => {
      await this.neueVersionen(tx, periode, regionCode, ForecastStatus.ABGESCHLOSSEN, aktor);
      await tx.forecastPeriode.update({ where: { id: p.id }, data: { status: ForecastStatus.ABGESCHLOSSEN, abgeschlossenAm: new Date() } });
      await this.audit.write({ entitaet: 'ForecastPeriode', entitaetId: p.id, aktion: 'STATUS_WECHSEL', userId: null, userEmail: 'SYSTEM', nachherWert: { status: 'ABGESCHLOSSEN' } }, tx);
    });
    return { status: ForecastStatus.ABGESCHLOSSEN };
  }

  private async neueVersionen(
    tx: Prisma.TransactionClient,
    periode: string,
    regionCode: string,
    status: ForecastStatus,
    aktor: RequestUser,
    adjust?: Map<string, { mw: MonatswerteRest; verletzt: boolean }>,
    kommentar?: string | null,
  ): Promise<void> {
    const latest = await this.latestVersionen(tx, periode, regionCode);
    for (const v of latest) {
      const k = `${v.landId}|${v.e1Id}`;
      const adj = adjust?.get(k);
      await tx.forecastVersion.create({
        data: {
          periode,
          jahr: v.jahr,
          monat: v.monat,
          regionCode,
          landId: v.landId,
          e1Id: v.e1Id,
          monatswerteRest: (adj?.mw ?? v.monatswerteRest) as Prisma.InputJsonValue,
          status,
          kommentar: kommentar ?? null,
          schwellwertVerletzt: adj?.verletzt ?? false,
          version: v.version + 1,
          userId: aktor.id,
        },
      });
    }
  }

  private async aktiveAgms(regionCode: string): Promise<string[]> {
    const heute = new Date();
    const vs = await this.prisma.regionsVerantwortung.findMany({
      where: { regionCode, geloeschtAm: null, gueltigVon: { lte: heute }, OR: [{ gueltigBis: null }, { gueltigBis: { gte: heute } }], user: { rolle: 'AGM', status: 'VERIFIZIERT' } },
      select: { user: { select: { email: true } } },
    });
    return [...new Set(vs.map((v) => v.user.email))];
  }

  async statusBoard() {
    return this.prisma.forecastPeriode.findMany({ orderBy: [{ periode: 'desc' }, { regionCode: 'asc' }], take: 200 });
  }

  /** Perioden im Scope des Nutzers (AGM: eigene Regionen). */
  async meinePerioden(aktor: RequestUser) {
    const scope = await this.scope.getScope(aktor);
    const where = scope.unbeschraenkt ? {} : { regionCode: { in: scope.regionCodes.length ? scope.regionCodes : ['__none__'] } };
    return this.prisma.forecastPeriode.findMany({ where, orderBy: [{ periode: 'desc' }, { regionCode: 'asc' }] });
  }

  /** Matrix Land × Produktgruppe für eine Region: Budget · Ist YTD · Forecast · YEE · Abweichung. */
  async matrix(periode: string, regionCode: string, aktor: RequestUser) {
    await this.assertAgmRead(aktor, regionCode);
    const { jahr, monat, monate } = this.restMonate(periode);
    const alleMonate = Array.from({ length: 12 }, (_, i) => i + 1);
    const monateKeys = alleMonate.map((m) => formatPeriode(jahr, m));
    const ksts = await this.prisma.kostenstelle.findMany({ where: { regionCode }, select: { id: true } });
    const [budgetCells, budgetCellsAlle, latest, istGrp, istMonatsGrp, e1s, laender] = await Promise.all([
      this.budgetRestProCell(jahr, regionCode, monate),
      this.budgetRestProCell(jahr, regionCode, alleMonate),
      this.latestVersionen(this.prisma, periode, regionCode),
      this.prisma.istUmsatz.groupBy({ by: ['landId', 'e1Id'], where: { jahr, monat: { lt: monat }, kostenstelleId: { in: ksts.map((k) => k.id) } }, _sum: { wertEur: true } }),
      this.prisma.istUmsatz.groupBy({ by: ['landId', 'e1Id', 'monat'], where: { jahr, kostenstelleId: { in: ksts.map((k) => k.id) } }, _sum: { wertEur: true } }),
      this.prisma.produktgruppeE1.findMany({ select: { id: true, nameDe: true } }),
      this.prisma.land.findMany({ select: { isoCode: true, nameDe: true } }),
    ]);
    const istMap = new Map(istGrp.map((g) => [`${g.landId}|${g.e1Id}`, Number(g._sum.wertEur ?? 0)]));
    const istMonateMap = new Map<string, Record<string, number>>();
    for (const g of istMonatsGrp) {
      const key = `${g.landId}|${g.e1Id}`;
      const rec = istMonateMap.get(key) ?? {};
      rec[formatPeriode(jahr, g.monat)] = Number(g._sum.wertEur ?? 0);
      istMonateMap.set(key, rec);
    }
    const eurProMonat = (mw: MonatswerteRest | undefined): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const [p, w] of Object.entries(mw ?? {})) out[p] = w?.eur ?? 0;
      return out;
    };
    const e1Name = new Map(e1s.map((e) => [e.id, e.nameDe]));
    const landName = new Map(laender.map((l) => [l.isoCode, l.nameDe]));
    const schwelle = await this.schwellwert();
    const monatsSchwelle = await this.monatsSchwellwert();

    const zellen = latest.map((v) => {
      const key = `${v.landId}|${v.e1Id}`;
      const forecastRest = summeEur(v.monatswerteRest as unknown as MonatswerteRest);
      const budgetRest = budgetCells.has(key) ? summeEur(budgetCells.get(key) as MonatswerteRest) : 0;
      const istYtd = istMap.get(key) ?? 0;
      const yee = istYtd + forecastRest;
      const abwProzent = budgetRest === 0 ? null : ((forecastRest - budgetRest) / Math.abs(budgetRest)) * 100;
      return {
        landId: v.landId,
        landName: landName.get(v.landId) ?? v.landId,
        e1Id: v.e1Id,
        e1Name: e1Name.get(v.e1Id) ?? v.e1Id,
        status: v.status,
        budgetRest,
        istYtd,
        forecastRest,
        yee,
        abweichungEur: forecastRest - budgetRest,
        abweichungProzent: abwProzent,
        ampel: abwProzent === null ? 'grau' : Math.abs(abwProzent) > schwelle ? 'rot' : 'gruen',
        monatswerteRest: v.monatswerteRest,
        budgetMonate: eurProMonat(budgetCellsAlle.get(key)),
        istMonate: istMonateMap.get(key) ?? {},
      };
    });
    zellen.sort((a, b) => a.e1Name.localeCompare(b.e1Name) || a.landName.localeCompare(b.landName));
    const periodeInfo = await this.ladePeriode(periode, regionCode);
    return {
      periode,
      regionCode,
      status: periodeInfo.status,
      deadline: periodeInfo.deadline,
      schwellwertProzent: schwelle,
      monatsSchwellwertProzent: monatsSchwelle,
      monate: monateKeys,
      restAbMonat: monat,
      zellen,
    };
  }
}
