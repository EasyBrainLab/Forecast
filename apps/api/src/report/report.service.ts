import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MonthlyReport, Prisma, ReportAbschnitt, ReportEintrag } from '@prisma/client';
import { EINSTELLUNG_KEYS } from '@forecast/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../scope/scope.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';

const ABSCHNITTE: readonly ReportAbschnitt[] = ['KRITISCH', 'IMPLANTATION', 'AKTIVITAET_NEUKUNDE', 'AKTIVITAET_BESTAND', 'MARKETING', 'PROJEKT', 'NAECHSTE_AKTIVITAET', 'WETTBEWERB'];
const KRITISCH_TYPEN = ['TENDER', 'KUNDENVERLUST', 'NEUKUNDE', 'PRODUKTPROBLEM', 'LIEFERPROBLEM', 'SONSTIGES'];
const AKTIVITAET_TYPEN = ['BESUCH', 'TRAINING', 'MEETING', 'SUPPORT'];

const dec = (d: Prisma.Decimal | null): number | null => (d == null ? null : Number(d));

/** Kopf-Felder, die der AGM setzen darf (Whitelist-PATCH). */
export interface ReportKopfInput {
  forecastFolgemonatEur?: number | null;
  forecastQuartalEur?: number | null;
  wettbewerbKeineAenderung?: boolean;
  marktAllgemein?: string | null;
  personal?: string | null;
  sonstiges?: string | null;
}

export interface EintragInput {
  abschnitt?: string;
  typ?: string | null;
  customerSiteId?: string | null;
  competitorId?: string | null;
  tenderId?: string | null;
  e1Id?: string | null;
  datum?: string | null;
  beschreibung?: string;
  ergebnis?: string | null;
  landIso?: string | null;
  stadt?: string | null;
  erwarteterUmsatzEur?: number | null;
  wahrscheinlichkeit?: number | null;
  kostenEur?: number | null;
  menge?: number | null;
  preisInfo?: string | null;
}

type ReportMitEintraegen = MonthlyReport & { eintraege: (ReportEintrag & { customerSite: { name: string } | null; competitor: { name: string } | null; tender: { referenznummer: string } | null; e1: { nameDe: string } | null })[] };

@Injectable()
export class ReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  private parsePeriode(periode: string): { jahr: number; monat: number } {
    const m = /^(\d{4})-(\d{2})$/.exec(periode);
    if (!m) throw new BadRequestException('Periode muss Format JJJJ-MM haben.');
    const monat = Number(m[2]);
    if (monat < 1 || monat > 12) throw new BadRequestException('Ungültiger Monat.');
    return { jahr: Number(m[1]), monat };
  }

  /** Sichtbare Regionen: AGM -> eigene, alle anderen -> alle forecast-relevanten (Muster agm-statement). */
  private async sichtbareRegionen(aktor: RequestUser): Promise<{ code: string; bezeichnung: string }[]> {
    if (aktor.rolle === 'AGM') {
      const s = await this.scope.getScope(aktor);
      if (s.regionCodes.length === 0) return [];
      return this.prisma.region.findMany({ where: { code: { in: s.regionCodes } }, select: { code: true, bezeichnung: true }, orderBy: { code: 'asc' } });
    }
    return this.prisma.region.findMany({ where: { forecastRelevant: true }, select: { code: true, bezeichnung: true }, orderBy: { code: 'asc' } });
  }

  private async assertSchreibbar(aktor: RequestUser, regionCode: string): Promise<void> {
    if (aktor.rolle !== 'AGM') {
      if (aktor.rolle === 'ADMIN') return; // Admin darf korrigierend eingreifen
      throw new ForbiddenException('Nur AGM erfassen Monatsberichte.');
    }
    const s = await this.scope.getScope(aktor);
    this.scope.assertSchreibScope(s, regionCode);
  }

  private toDto(r: ReportMitEintraegen) {
    return {
      id: r.id,
      periode: r.periode,
      regionCode: r.regionCode,
      status: r.status,
      userName: r.userName,
      forecastFolgemonatEur: dec(r.forecastFolgemonatEur),
      forecastQuartalEur: dec(r.forecastQuartalEur),
      wettbewerbKeineAenderung: r.wettbewerbKeineAenderung,
      marktAllgemein: r.marktAllgemein,
      personal: r.personal,
      sonstiges: r.sonstiges,
      eingereichtAm: r.eingereichtAm,
      gelesenAm: r.gelesenAm,
      gelesenVon: r.gelesenVon,
      aktualisiertAm: r.aktualisiertAm,
      eintraege: r.eintraege
        .slice()
        .sort((a, b) => a.sortierung - b.sortierung || a.erstelltAm.getTime() - b.erstelltAm.getTime())
        .map((e) => ({
          id: e.id,
          abschnitt: e.abschnitt,
          typ: e.typ,
          customerSiteId: e.customerSiteId,
          customerSiteName: e.customerSite?.name ?? null,
          competitorId: e.competitorId,
          competitorName: e.competitor?.name ?? null,
          tenderId: e.tenderId,
          tenderReferenz: e.tender?.referenznummer ?? null,
          e1Id: e.e1Id,
          e1Name: e.e1?.nameDe ?? null,
          datum: e.datum,
          beschreibung: e.beschreibung,
          ergebnis: e.ergebnis,
          landIso: e.landIso,
          stadt: e.stadt,
          erwarteterUmsatzEur: dec(e.erwarteterUmsatzEur),
          wahrscheinlichkeit: e.wahrscheinlichkeit,
          kostenEur: dec(e.kostenEur),
          menge: dec(e.menge),
          preisInfo: e.preisInfo,
        })),
    };
  }

  private include() {
    return {
      eintraege: {
        include: {
          customerSite: { select: { name: true } },
          competitor: { select: { name: true } },
          tender: { select: { referenznummer: true } },
          e1: { select: { nameDe: true } },
        },
      },
    } as const;
  }

  // ─────────── Lesen ───────────

  /** Berichte einer Periode für die sichtbaren Regionen (existierend oder Skelett). */
  async fuerPeriode(periode: string, aktor: RequestUser) {
    this.parsePeriode(periode);
    const regionen = await this.sichtbareRegionen(aktor);
    const codes = regionen.map((r) => r.code);
    const vorhandene = await this.prisma.monthlyReport.findMany({
      where: { periode, regionCode: { in: codes.length ? codes : ['__none__'] } },
      include: this.include(),
    });
    const byRegion = new Map(vorhandene.map((r) => [r.regionCode, r]));
    return {
      periode,
      bearbeitbar: aktor.rolle === 'AGM',
      regionen: regionen.map((r) => {
        const rep = byRegion.get(r.code);
        return {
          regionCode: r.code,
          bezeichnung: r.bezeichnung,
          status: rep?.status ?? 'OFFEN',
          report: rep ? this.toDto(rep as ReportMitEintraegen) : null,
        };
      }),
    };
  }

  /**
   * Automatische Zahlensektion (Abschnitt 2): je Produktlinie Plan/Ist des Berichtsmonats + YTD + Vorjahr.
   * Kein manuelles Abtippen — die Zahlen kommen aus Budget/IstUmsatz (GL) der Region.
   */
  async zahlen(periode: string, regionCode: string, aktor: RequestUser) {
    const { jahr, monat } = this.parsePeriode(periode);
    // Lese-Scope: AGM nur eigene Region.
    if (aktor.rolle === 'AGM') {
      const s = await this.scope.getScope(aktor);
      if (!s.unbeschraenkt && !s.regionCodes.includes(regionCode)) throw new ForbiddenException('Kein Zugriff auf diese Region.');
    }
    const ksts = await this.prisma.kostenstelle.findMany({ where: { regionCode }, select: { id: true } });
    const kstIds = ksts.map((k) => k.id);
    const e1s = await this.prisma.produktgruppeE1.findMany({ where: { kategorie: { not: 'ZENTRAL' } }, orderBy: { sortierung: 'asc' } });

    const istWhere = (von: number, bis: number, j: number): Prisma.IstUmsatzWhereInput => ({
      kostenstelleId: { in: kstIds.length ? kstIds : ['__none__'] },
      jahr: j,
      monat: { gte: von, lte: bis },
    });
    const [istMonat, istYtd, istVorjahrMonat, istVorjahrYtd, budgetJahr] = await Promise.all([
      this.prisma.istUmsatz.groupBy({ by: ['e1Id'], where: istWhere(monat, monat, jahr), _sum: { wertEur: true } }),
      this.prisma.istUmsatz.groupBy({ by: ['e1Id'], where: istWhere(1, monat, jahr), _sum: { wertEur: true } }),
      this.prisma.istUmsatz.groupBy({ by: ['e1Id'], where: istWhere(monat, monat, jahr - 1), _sum: { wertEur: true } }),
      this.prisma.istUmsatz.groupBy({ by: ['e1Id'], where: istWhere(1, monat, jahr - 1), _sum: { wertEur: true } }),
      this.prisma.budget.groupBy({
        by: ['e1Id', 'monat'],
        where: { regionCode, jahr, status: 'AKTIV', istRegionsreserve: false, monat: { not: null } },
        _sum: { wertEur: true },
      }),
    ]);
    const summe = (rows: { e1Id: string; _sum: { wertEur: Prisma.Decimal | null } }[], e1Id: string): number =>
      rows.filter((r) => r.e1Id === e1Id).reduce((s, r) => s + Number(r._sum.wertEur ?? 0), 0);
    const budget = (e1Id: string, von: number, bis: number): number =>
      budgetJahr.filter((b) => b.e1Id === e1Id && b.monat !== null && b.monat >= von && b.monat <= bis).reduce((s, b) => s + Number(b._sum.wertEur ?? 0), 0);

    const zeilen = e1s.map((e1) => {
      const planMonat = budget(e1.id, monat, monat);
      const istM = summe(istMonat as never, e1.id);
      const deltaEur = istM - planMonat;
      const deltaProzent = planMonat !== 0 ? Math.round((deltaEur / Math.abs(planMonat)) * 1000) / 10 : null;
      return {
        e1Id: e1.id,
        e1Name: e1.nameDe,
        planMonat,
        istMonat: istM,
        deltaEur,
        deltaProzent,
        planYtd: budget(e1.id, 1, monat),
        istYtd: summe(istYtd as never, e1.id),
        vorjahrMonat: summe(istVorjahrMonat as never, e1.id),
        vorjahrYtd: summe(istVorjahrYtd as never, e1.id),
      };
    });
    return { periode, regionCode, zeilen };
  }

  /** Manager-Board: Abgabestatus je Region für eine Periode inkl. Überfälligkeit. */
  async board(periode: string, aktor: RequestUser) {
    const { jahr, monat } = this.parsePeriode(periode);
    const regionen = await this.sichtbareRegionen(aktor);
    const reports = await this.prisma.monthlyReport.findMany({ where: { periode }, select: { regionCode: true, status: true, eingereichtAm: true, gelesenAm: true, gelesenVon: true, userName: true } });
    const byRegion = new Map(reports.map((r) => [r.regionCode, r]));
    const deadlineTag = Number((await this.prisma.einstellung.findUnique({ where: { key: EINSTELLUNG_KEYS.REPORT_DEADLINE_TAG } }))?.value ?? 10);
    // Abgabefrist: Tag X des FOLGEmonats des Berichtsmonats.
    const frist = new Date(Date.UTC(monat === 12 ? jahr + 1 : jahr, monat === 12 ? 0 : monat, deadlineTag, 23, 59, 59));
    const jetzt = new Date();
    return {
      periode,
      frist,
      regionen: regionen.map((r) => {
        const rep = byRegion.get(r.code);
        const eingereicht = rep?.status === 'EINGEREICHT' || rep?.status === 'GELESEN';
        return {
          regionCode: r.code,
          bezeichnung: r.bezeichnung,
          status: rep?.status ?? 'FEHLT',
          eingereichtAm: rep?.eingereichtAm ?? null,
          gelesenAm: rep?.gelesenAm ?? null,
          gelesenVon: rep?.gelesenVon ?? null,
          userName: rep?.userName ?? null,
          ueberfaellig: !eingereicht && jetzt > frist,
        };
      }),
    };
  }

  // ─────────── Schreiben ───────────

  private async holeOderErstelle(periode: string, regionCode: string, aktor: RequestUser): Promise<MonthlyReport> {
    const { jahr, monat } = this.parsePeriode(periode);
    const vorhanden = await this.prisma.monthlyReport.findUnique({ where: { periode_regionCode: { periode, regionCode } } });
    if (vorhanden) return vorhanden;
    const user = await this.prisma.user.findUnique({ where: { id: aktor.id }, select: { name: true } });
    return this.prisma.monthlyReport.create({ data: { periode, jahr, monat, regionCode, userId: aktor.id, userName: user?.name ?? aktor.email } });
  }

  private assertEntwurf(r: MonthlyReport): void {
    if (r.status === 'EINGEREICHT' || r.status === 'GELESEN') throw new ForbiddenException('Bericht ist eingereicht und gesperrt. Zum Ändern erst wieder öffnen.');
  }

  /** Kopf-Felder speichern (Whitelist-PATCH; legt den Bericht bei Bedarf an). */
  async speichernKopf(periode: string, regionCode: string, input: ReportKopfInput, aktor: RequestUser) {
    await this.assertSchreibbar(aktor, regionCode);
    const report = await this.holeOderErstelle(periode, regionCode, aktor);
    this.assertEntwurf(report);
    const data: Prisma.MonthlyReportUncheckedUpdateInput = {};
    if (input.forecastFolgemonatEur !== undefined) data.forecastFolgemonatEur = input.forecastFolgemonatEur;
    if (input.forecastQuartalEur !== undefined) data.forecastQuartalEur = input.forecastQuartalEur;
    if (input.wettbewerbKeineAenderung !== undefined) data.wettbewerbKeineAenderung = input.wettbewerbKeineAenderung;
    if (input.marktAllgemein !== undefined) data.marktAllgemein = input.marktAllgemein ? String(input.marktAllgemein).slice(0, 4000) : null;
    if (input.personal !== undefined) data.personal = input.personal ? String(input.personal).slice(0, 4000) : null;
    if (input.sonstiges !== undefined) data.sonstiges = input.sonstiges ? String(input.sonstiges).slice(0, 4000) : null;
    data.userId = aktor.id;
    const user = await this.prisma.user.findUnique({ where: { id: aktor.id }, select: { name: true } });
    data.userName = user?.name ?? aktor.email;
    const result = await this.prisma.monthlyReport.update({ where: { id: report.id }, data, include: this.include() });
    await this.audit.write({ entitaet: 'MonthlyReport', entitaetId: report.id, aktion: 'UPDATE', userId: aktor.id, userEmail: aktor.email, metadaten: { periode, regionCode, felder: Object.keys(data) } });
    return this.toDto(result as ReportMitEintraegen);
  }

  private sanitizeEintrag(input: EintragInput, abschnitt: ReportAbschnitt): Prisma.ReportEintragUncheckedCreateInput {
    const beschreibung = String(input.beschreibung ?? '').trim();
    if (!beschreibung) throw new BadRequestException('Beschreibung ist erforderlich.');
    if (abschnitt === 'KRITISCH' && input.typ && !KRITISCH_TYPEN.includes(input.typ)) throw new BadRequestException('Ungültiger Typ für kritisches Thema.');
    if ((abschnitt === 'AKTIVITAET_NEUKUNDE' || abschnitt === 'AKTIVITAET_BESTAND') && input.typ && !AKTIVITAET_TYPEN.includes(input.typ)) throw new BadRequestException('Ungültiger Aktivitätstyp.');
    if (abschnitt === 'WETTBEWERB' && !input.competitorId) throw new BadRequestException('Wettbewerbsbeobachtung braucht einen Wettbewerber aus der Stammliste.');
    const wahrscheinlichkeit = input.wahrscheinlichkeit == null ? null : Math.max(0, Math.min(100, Math.round(Number(input.wahrscheinlichkeit))));
    const datum = input.datum ? new Date(input.datum) : null;
    if (datum && Number.isNaN(datum.getTime())) throw new BadRequestException('Ungültiges Datum.');
    return {
      reportId: '', // wird vom Aufrufer gesetzt
      abschnitt,
      typ: input.typ ?? null,
      customerSiteId: input.customerSiteId || null,
      competitorId: input.competitorId || null,
      tenderId: input.tenderId || null,
      e1Id: input.e1Id || null,
      datum,
      beschreibung: beschreibung.slice(0, 4000),
      ergebnis: input.ergebnis ? String(input.ergebnis).slice(0, 4000) : null,
      landIso: input.landIso ? String(input.landIso).slice(0, 8) : null,
      stadt: input.stadt ? String(input.stadt).slice(0, 120) : null,
      erwarteterUmsatzEur: input.erwarteterUmsatzEur ?? null,
      wahrscheinlichkeit,
      kostenEur: input.kostenEur ?? null,
      menge: input.menge ?? null,
      preisInfo: input.preisInfo ? String(input.preisInfo).slice(0, 1000) : null,
    };
  }

  async eintragAnlegen(periode: string, regionCode: string, input: EintragInput, aktor: RequestUser) {
    await this.assertSchreibbar(aktor, regionCode);
    if (!ABSCHNITTE.includes((input.abschnitt ?? '') as ReportAbschnitt)) throw new BadRequestException('Ungültiger Abschnitt.');
    const report = await this.holeOderErstelle(periode, regionCode, aktor);
    this.assertEntwurf(report);
    const data = this.sanitizeEintrag(input, input.abschnitt as ReportAbschnitt);
    data.reportId = report.id;
    const created = await this.prisma.reportEintrag.create({ data });
    await this.audit.write({ entitaet: 'ReportEintrag', entitaetId: created.id, aktion: 'CREATE', userId: aktor.id, userEmail: aktor.email, metadaten: { periode, regionCode, abschnitt: input.abschnitt } });
    const result = await this.prisma.monthlyReport.findUniqueOrThrow({ where: { id: report.id }, include: this.include() });
    return this.toDto(result as ReportMitEintraegen);
  }

  async eintragLoeschen(id: string, aktor: RequestUser) {
    const eintrag = await this.prisma.reportEintrag.findUnique({ where: { id }, include: { report: true } });
    if (!eintrag) throw new NotFoundException('Eintrag nicht gefunden.');
    await this.assertSchreibbar(aktor, eintrag.report.regionCode);
    this.assertEntwurf(eintrag.report);
    await this.prisma.reportEintrag.delete({ where: { id } });
    await this.audit.write({ entitaet: 'ReportEintrag', entitaetId: id, aktion: 'DELETE', userId: aktor.id, userEmail: aktor.email, metadaten: { abschnitt: eintrag.abschnitt } });
    const result = await this.prisma.monthlyReport.findUniqueOrThrow({ where: { id: eintrag.reportId }, include: this.include() });
    return this.toDto(result as ReportMitEintraegen);
  }

  /** Einreichen mit Pflichtprüfung (Auftrag: Abschnitte 2/5/7 — Zahlen sind automatisch, geprüft werden 5 + 7). */
  async einreichen(periode: string, regionCode: string, aktor: RequestUser) {
    await this.assertSchreibbar(aktor, regionCode);
    const report = await this.prisma.monthlyReport.findUnique({ where: { periode_regionCode: { periode, regionCode } }, include: { eintraege: { select: { abschnitt: true } } } });
    if (!report) throw new NotFoundException('Kein Berichts-Entwurf vorhanden.');
    if (report.status === 'EINGEREICHT' || report.status === 'GELESEN') throw new ForbiddenException('Bereits eingereicht.');
    const fehlend: string[] = [];
    if (report.forecastFolgemonatEur == null) fehlend.push('FORECAST_FOLGEMONAT');
    if (report.forecastQuartalEur == null) fehlend.push('FORECAST_QUARTAL');
    const hatWettbewerb = report.eintraege.some((e) => e.abschnitt === 'WETTBEWERB');
    if (!hatWettbewerb && !report.wettbewerbKeineAenderung) fehlend.push('WETTBEWERB');
    if (fehlend.length) throw new BadRequestException(`Pflichtabschnitte unvollständig: ${fehlend.join(', ')}`);
    // Status-Lock ohne TOCTOU.
    const upd = await this.prisma.monthlyReport.updateMany({ where: { id: report.id, status: { in: ['ENTWURF', 'IN_PRUEFUNG_KI'] } }, data: { status: 'EINGEREICHT', eingereichtAm: new Date() } });
    if (upd.count === 0) throw new ConflictException('Bericht wurde zwischenzeitlich geändert.');
    await this.audit.write({ entitaet: 'MonthlyReport', entitaetId: report.id, aktion: 'STATUS_WECHSEL', userId: aktor.id, userEmail: aktor.email, vorherWert: { status: report.status }, nachherWert: { status: 'EINGEREICHT' }, metadaten: { periode, regionCode } });
    const result = await this.prisma.monthlyReport.findUniqueOrThrow({ where: { id: report.id }, include: this.include() });
    return this.toDto(result as ReportMitEintraegen);
  }

  /** Wieder öffnen (eigener AGM oder ADMIN) — Korrekturen nur als neue Bearbeitung mit Audit-Spur. */
  async zuruecksetzen(periode: string, regionCode: string, aktor: RequestUser) {
    const report = await this.prisma.monthlyReport.findUnique({ where: { periode_regionCode: { periode, regionCode } } });
    if (!report) throw new NotFoundException('Kein Bericht vorhanden.');
    if (aktor.rolle === 'AGM') {
      const s = await this.scope.getScope(aktor);
      this.scope.assertSchreibScope(s, regionCode);
    } else if (aktor.rolle !== 'ADMIN') {
      throw new ForbiddenException('Nur AGM (eigene Region) oder Admin.');
    }
    const result = await this.prisma.monthlyReport.update({ where: { id: report.id }, data: { status: 'ENTWURF', eingereichtAm: null, gelesenAm: null, gelesenVon: null }, include: this.include() });
    await this.audit.write({ entitaet: 'MonthlyReport', entitaetId: report.id, aktion: 'STATUS_WECHSEL', userId: aktor.id, userEmail: aktor.email, vorherWert: { status: report.status }, nachherWert: { status: 'ENTWURF' }, metadaten: { periode, regionCode } });
    return this.toDto(result as ReportMitEintraegen);
  }

  /** Lesebestätigung durch Vertriebs-/BU-Leitung. */
  async gelesen(periode: string, regionCode: string, aktor: RequestUser) {
    const report = await this.prisma.monthlyReport.findUnique({ where: { periode_regionCode: { periode, regionCode } } });
    if (!report) throw new NotFoundException('Kein Bericht vorhanden.');
    if (report.status !== 'EINGEREICHT') throw new BadRequestException('Nur eingereichte Berichte können als gelesen markiert werden.');
    const result = await this.prisma.monthlyReport.update({ where: { id: report.id }, data: { status: 'GELESEN', gelesenAm: new Date(), gelesenVon: aktor.email }, include: this.include() });
    await this.audit.write({ entitaet: 'MonthlyReport', entitaetId: report.id, aktion: 'STATUS_WECHSEL', userId: aktor.id, userEmail: aktor.email, vorherWert: { status: 'EINGEREICHT' }, nachherWert: { status: 'GELESEN' }, metadaten: { periode, regionCode } });
    return this.toDto(result as ReportMitEintraegen);
  }
}
