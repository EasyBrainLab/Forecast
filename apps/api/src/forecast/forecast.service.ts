import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ForecastStatus, Prisma } from '@prisma/client';
import {
  abwProz,
  EINSTELLUNG_KEYS,
  FORECAST_TRANSITIONS,
  formatPeriode,
  parsePeriode,
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
import { KOMMENTAR_MAX } from './forecast.dto';
import type { AnpassenDto, UeberschreibenDto } from './forecast.dto';

type Client = PrismaService | Prisma.TransactionClient;

function summeEur(mw: MonatswerteRest): number {
  return Object.values(mw).reduce((s, x) => s + (x?.eur ?? 0), 0);
}

/**
 * Übernimmt eur/units aus `neu`, erhält aber den Per-Monats-Kommentar der Vorversion,
 * wenn `neu` für den Monat keinen mitliefert (z. B. Edit über die aggregierte /forecast-Seite).
 * Schützt die auditrelevante Abweichungs-Begründung vor stillem Verlust.
 */
function mergeMonatsKommentar(prev: MonatswerteRest, neu: MonatswerteRest): MonatswerteRest {
  const out: MonatswerteRest = {};
  for (const [p, w] of Object.entries(neu)) {
    const komm = w.kommentar?.trim() ? w.kommentar : prev[p]?.kommentar ?? null;
    out[p] = { eur: w.eur, units: w.units ?? null, ...(komm ? { kommentar: komm } : {}) };
  }
  return out;
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

  /**
   * Perioden-Filter für die Abschluss-/Wiedereröffnungs-Kaskade. Verglichen wird über die indizierten
   * Felder jahr/monat (@@index([jahr, monat])) statt über den periode-String — dessen Ordnung hinge
   * sonst an der DB-Collation.
   */
  private static bisEinschliesslich(p: { jahr: number; monat: number }): Prisma.ForecastPeriodeWhereInput {
    return { OR: [{ jahr: { lt: p.jahr } }, { jahr: p.jahr, monat: { lte: p.monat } }] };
  }

  private static abEinschliesslich(p: { jahr: number; monat: number }): Prisma.ForecastPeriodeWhereInput {
    return { OR: [{ jahr: { gt: p.jahr } }, { jahr: p.jahr, monat: { gte: p.monat } }] };
  }

  /** Liest eine numerische Einstellung fail-safe: nicht-numerische/fehlende Werte fallen auf den Default zurück. */
  private async numEinstellung(key: string, def: number): Promise<number> {
    const e = await this.prisma.einstellung.findUnique({ where: { key } });
    const n = Number(e?.value);
    return Number.isFinite(n) ? n : def;
  }

  private schwellwert(): Promise<number> {
    return this.numEinstellung(EINSTELLUNG_KEYS.SCHWELLWERT_PROZENT, 10);
  }

  /** Schwellwert je Einzelmonat (Forecast vs. Budget des jeweiligen Monats). */
  private monatsSchwellwert(): Promise<number> {
    return this.numEinstellung(EINSTELLUNG_KEYS.MONATS_SCHWELLWERT_PROZENT, 5);
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
    const deadlineTag = await this.numEinstellung(EINSTELLUNG_KEYS.DEADLINE_TAG, 10);
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

  /**
   * Legt eine neue Forecast-Zeile (Land × Produktgruppe) in einer OFFENEN Periode an (Startwerte 0 je Restmonat).
   * Konsistenz: Periode offen, Land & Produktgruppe müssen existieren, die Kombination darf noch nicht vorhanden sein.
   */
  async neueZeile(periode: string, regionCode: string, landId: string, e1Id: string, aktor: RequestUser): Promise<void> {
    await this.assertSchreib(aktor, regionCode);
    const p = await this.ladePeriode(periode, regionCode);
    if (p.status !== ForecastStatus.OFFEN) throw new ConflictException('Neue Zeilen sind nur in einer offenen Periode möglich.');
    const { jahr, monat, monate } = this.restMonate(periode);
    const [land, e1] = await Promise.all([
      this.prisma.land.findUnique({ where: { isoCode: landId } }),
      this.prisma.produktgruppeE1.findUnique({ where: { id: e1Id } }),
    ]);
    if (!land) throw new BadRequestException('Unbekanntes Land.');
    if (!e1) throw new BadRequestException('Unbekannte Produktgruppe.');
    const vorhanden = await this.latestVersionen(this.prisma, periode, regionCode);
    if (vorhanden.some((v) => v.landId === landId && v.e1Id === e1Id)) {
      throw new ConflictException('Diese Kombination aus Produktgruppe und Land ist bereits vorhanden.');
    }
    const mw: MonatswerteRest = {};
    for (const m of monate) mw[formatPeriode(jahr, m)] = { eur: 0, units: null };
    const created = await this.prisma.forecastVersion.create({
      data: { periode, jahr, monat, regionCode, landId, e1Id, monatswerteRest: mw as unknown as Prisma.InputJsonValue, status: ForecastStatus.OFFEN, version: 1, userId: aktor.id },
    });
    await this.audit.write({
      entitaet: 'ForecastVersion',
      entitaetId: created.id,
      aktion: 'CREATE',
      userId: aktor.id,
      userEmail: aktor.email,
      metadaten: { periode, regionCode, landId, e1Id, aktion: 'NEUE_ZEILE' },
    });
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

  /**
   * F1/F2: Finales Einreichen des Forecasts (AGM). Der AGM kann vorher beliebig oft speichern (anpassen);
   * erst hier wird eingereicht. Wurde gegenüber dem Budget angepasst -> ANGEPASST (mit Pflichtkommentar-
   * Prüfung + Meldung an Controlling/BU), sonst unverändert -> BESTAETIGT. Danach ist keine Bearbeitung mehr
   * möglich (Periode nicht mehr OFFEN).
   */
  async bestaetigen(periode: string, regionCode: string, aktor: RequestUser, stellungnahme?: string) {
    const p = await this.ladePeriode(periode, regionCode);
    await this.assertSchreib(aktor, regionCode);
    const { jahr, monate } = this.restMonate(periode);
    const [latest, budgetCells] = await Promise.all([this.latestVersionen(this.prisma, periode, regionCode), this.budgetRestProCell(jahr, regionCode, monate)]);
    const schwelle = await this.schwellwert();

    // Aus dem gespeicherten Entwurf ableiten: wurde gegenüber Budget angepasst (und ist ein Schwellwert verletzt)?
    let anzahlAngepasst = 0;
    let irgendVerletzt = false;
    for (const v of latest) {
      const key = `${v.landId}|${v.e1Id}`;
      const versionSumme = summeEur(v.monatswerteRest as unknown as MonatswerteRest);
      const budgetSumme = budgetCells.has(key) ? summeEur(budgetCells.get(key) as MonatswerteRest) : null;
      if (budgetSumme === null || Math.abs(versionSumme - budgetSumme) > 0.005) anzahlAngepasst++;
      if (istSchwellwertVerletzt(versionSumme, { budget: budgetSumme }, schwelle)) irgendVerletzt = true;
    }
    const angepasst = anzahlAngepasst > 0;
    const zielStatus = angepasst ? ForecastStatus.ANGEPASST : ForecastStatus.BESTAETIGT;
    const kommentar = stellungnahme?.trim() ? stellungnahme.trim().slice(0, KOMMENTAR_MAX) : null; // optionale Stellungnahme

    this.sm.pruefe(FORECAST_TRANSITIONS, p.status, zielStatus, { rolle: aktor.rolle, aktorId: aktor.id });

    const meldeEmpfaenger = angepasst ? await this.anpassungsMeldeEmpfaenger() : [];
    await this.prisma.$transaction(async (tx) => {
      await this.neueVersionen(tx, periode, regionCode, zielStatus, aktor, undefined, kommentar);
      await tx.forecastPeriode.update({ where: { id: p.id }, data: { status: zielStatus } });
      await this.audit.write(
        { entitaet: 'ForecastPeriode', entitaetId: p.id, aktion: 'STATUS_WECHSEL', userId: aktor.id, userEmail: aktor.email, nachherWert: { status: zielStatus, angepasst, schwellwertVerletzt: irgendVerletzt, ...(kommentar ? { stellungnahme: kommentar } : {}), ...(angepasst ? { anzahlAngepasst, gemeldetAn: meldeEmpfaenger } : {}) } },
        tx,
      );
    });

    if (angepasst) {
      // Meldung an Controlling + BU-Leitung nach Commit; Mail-Fehler brechen das Einreichen nicht ab.
      await this.meldeForecastAnpassung(periode, regionCode, aktor, { anzahlZellen: anzahlAngepasst, schwellwertVerletzt: irgendVerletzt, kommentar, empfaenger: meldeEmpfaenger });
    }
    return { status: zielStatus, angepasst, schwellwertVerletzt: irgendVerletzt, gemeldetAn: meldeEmpfaenger.length };
  }

  /**
   * Speichert Zellen-Anpassungen als Entwurf — die Periode bleibt OFFEN, damit der AGM weiter bearbeiten
   * kann. Eingereicht (BESTAETIGT/ANGEPASST) wird erst über bestaetigen(). Der Per-Monats-Pflichtkommentar
   * bei Schwellwert-Überschreitung wird bereits hier erzwungen, damit die Begründung nicht verloren geht.
   */
  async anpassen(periode: string, regionCode: string, aktor: RequestUser, dto: AnpassenDto) {
    const p = await this.ladePeriode(periode, regionCode);
    await this.assertSchreib(aktor, regionCode);
    if (p.status !== ForecastStatus.OFFEN) {
      throw new ConflictException('Forecast ist nicht (mehr) offen — Bearbeitung nicht möglich.');
    }
    const { jahr, monate } = this.restMonate(periode);
    const budgetCells = await this.budgetRestProCell(jahr, regionCode, monate);
    const schwelle = await this.schwellwert();

    // Keine Kommentarpflicht mehr: Abweichungen werden in der Sicht farblich markiert. Der Schwellwert-
    // Flag je Zelle bleibt nur informativ (Ampel); eine optionale Stellungnahme folgt beim Bestätigen.
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

    // Entwurf speichern: neue append-only Version mit Status OFFEN; die Periode bleibt OFFEN (kein Einreichen).
    await this.prisma.$transaction(async (tx) => {
      await this.neueVersionen(tx, periode, regionCode, ForecastStatus.OFFEN, aktor, adjust, dto.kommentar);
      await this.audit.write({ entitaet: 'ForecastPeriode', entitaetId: p.id, aktion: 'UPDATE', userId: aktor.id, userEmail: aktor.email, nachherWert: { status: 'OFFEN', entwurfGespeichert: true, anzahlZellen: adjust.size, schwellwertVerletzt: irgendVerletzt } }, tx);
    });

    return { status: ForecastStatus.OFFEN, gespeichert: adjust.size, schwellwertVerletzt: irgendVerletzt };
  }

  /** Empfänger der Forecast-Anpassungsmeldung: verifizierte BU-Leitung + konfiguriertes Controlling (Einstellung CONTROLLING_EMAILS). */
  private async anpassungsMeldeEmpfaenger(): Promise<string[]> {
    const buLeiter = await this.prisma.user.findMany({ where: { rolle: 'BU_LEITER', status: 'VERIFIZIERT' }, select: { email: true } });
    const controllingRaw = (await this.prisma.einstellung.findUnique({ where: { key: EINSTELLUNG_KEYS.CONTROLLING_EMAILS } }))?.value ?? '';
    const controlling = controllingRaw.split(',').map((s) => s.trim()).filter(Boolean);
    return [...new Set([...buLeiter.map((u) => u.email), ...controlling])];
  }

  /** Versendet die Anpassungs-Meldung (E&Z-CI). Kein Empfänger -> kein Versand (fail-safe). */
  private async meldeForecastAnpassung(
    periode: string,
    regionCode: string,
    aktor: RequestUser,
    info: { anzahlZellen: number; schwellwertVerletzt: boolean; kommentar: string | null; empfaenger: string[] },
  ): Promise<void> {
    if (info.empfaenger.length === 0) return;
    const schwelleHinweis = info.schwellwertVerletzt ? ' Mindestens eine Zelle überschreitet den Schwellwert — Begründung ist hinterlegt.' : '';
    const kommentarText = info.kommentar?.trim() ? ` Kommentar: ${info.kommentar.trim()}` : '';
    const text = `${aktor.email} hat den Forecast angepasst. Region ${regionCode}, Periode ${periode}, ${info.anzahlZellen} geänderte Zelle(n).${schwelleHinweis}${kommentarText}`;
    await Promise.all(info.empfaenger.map((e) => this.mail.send(e, infoMail('Forecast angepasst', `Region ${regionCode} · ${periode}`, text))));
  }

  /**
   * F10/F11: Fremdüberschreibung eines bereits fertiggemeldeten Forecasts (BESTAETIGT/ANGEPASST) durch
   * Vertriebs-/BU-Leitung. Erzeugt eine neue append-only ANGEPASST-Version, markiert die Periode als
   * fremdüberschrieben (Kenntnisnahme durch AGM nötig) und informiert die AGM der Region. Begründung Pflicht.
   */
  async ueberschreiben(periode: string, regionCode: string, aktor: RequestUser, dto: UeberschreibenDto) {
    const p = await this.ladePeriode(periode, regionCode);
    const { jahr, monate } = this.restMonate(periode);
    const budgetCells = await this.budgetRestProCell(jahr, regionCode, monate);
    const schwelle = await this.schwellwert();

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

    // F10 (BESTAETIGT→ANGEPASST) oder F11 (ANGEPASST→ANGEPASST); Rolle VL/BU + Pflicht-Begründung.
    this.sm.pruefe(FORECAST_TRANSITIONS, p.status, ForecastStatus.ANGEPASST, { rolle: aktor.rolle, aktorId: aktor.id, begruendung: dto.begruendung });

    const jetzt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.neueVersionen(tx, periode, regionCode, ForecastStatus.ANGEPASST, aktor, adjust, dto.begruendung);
      await tx.forecastPeriode.update({
        where: { id: p.id },
        data: { status: ForecastStatus.ANGEPASST, fremdaenderungAm: jetzt, fremdaenderungVon: aktor.email, fremdaenderungBegruendung: dto.begruendung, fremdaenderungQuittiertAm: null },
      });
      await this.audit.write(
        { entitaet: 'ForecastPeriode', entitaetId: p.id, aktion: 'STATUS_WECHSEL', userId: aktor.id, userEmail: aktor.email, vorherWert: { status: p.status }, nachherWert: { status: 'ANGEPASST', fremdueberschrieben: true, anzahlZellen: adjust.size, begruendung: dto.begruendung } },
        tx,
      );
    });

    const agms = await this.aktiveAgms(regionCode);
    await Promise.all(
      agms.map((e) =>
        this.mail.send(e, infoMail('Forecast von der Leitung überschrieben', 'Bitte zur Kenntnis nehmen', `${aktor.email} hat den Forecast für Region ${regionCode}, Periode ${periode} überschrieben (${adjust.size} Zelle(n)). Begründung: ${dto.begruendung}. Bitte im Portal zur Kenntnis nehmen.`)),
      ),
    );
    return { status: ForecastStatus.ANGEPASST, schwellwertVerletzt: irgendVerletzt, gemeldetAn: agms.length };
  }

  /** AGM nimmt eine Fremdüberschreibung zur Kenntnis (setzt den Quittier-Zeitstempel, informiert die Leitung). */
  async quittieren(periode: string, regionCode: string, aktor: RequestUser) {
    const p = await this.ladePeriode(periode, regionCode);
    await this.assertSchreib(aktor, regionCode);
    if (!p.fremdaenderungAm || p.fremdaenderungQuittiertAm) {
      throw new BadRequestException('Keine offene Fremdüberschreibung zur Kenntnisnahme.');
    }
    const jetzt = new Date();
    await this.prisma.forecastPeriode.update({ where: { id: p.id }, data: { fremdaenderungQuittiertAm: jetzt } });
    await this.audit.write({ entitaet: 'ForecastPeriode', entitaetId: p.id, aktion: 'UPDATE', userId: aktor.id, userEmail: aktor.email, nachherWert: { fremdaenderungQuittiertAm: jetzt } });
    if (p.fremdaenderungVon) {
      await this.mail.send(p.fremdaenderungVon, infoMail('Überschreibung zur Kenntnis genommen', 'Bestätigt', `${aktor.email} hat die Forecast-Überschreibung für Region ${regionCode}, Periode ${periode} zur Kenntnis genommen.`));
    }
    return { quittiertAm: jetzt };
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

  /**
   * F6/F7/F8 (Monatsabschluss) -> ABGESCHLOSSEN, ausgelöst vom Cron oder manuell durch BU-Leiter/Admin.
   * Kaskadiert auf alle älteren, noch nicht abgeschlossenen Perioden derselben Region: bis zur jüngsten
   * abgeschlossenen Periode ist damit lückenlos alles zu. Idempotent — ist nichts mehr offen, passiert nichts.
   */
  async abschliessen(periode: string, regionCode: string, aktor: RequestUser, opt: { system?: boolean } = {}) {
    const ziel = await this.ladePeriode(periode, regionCode);
    const system = opt.system === true;
    const offene = await this.prisma.forecastPeriode.findMany({
      where: { regionCode, status: { not: ForecastStatus.ABGESCHLOSSEN }, ...ForecastService.bisEinschliesslich(ziel) },
      orderBy: [{ jahr: 'asc' }, { monat: 'asc' }],
    });
    // Alle Übergänge vorab prüfen (403/409), damit die Transaktion nicht auf halbem Weg abbricht.
    for (const p of offene) {
      this.sm.pruefe(FORECAST_TRANSITIONS, p.status, ForecastStatus.ABGESCHLOSSEN, { rolle: aktor.rolle, aktorId: aktor.id, system });
    }
    const abgeschlossen = offene.map((p) => p.periode);
    if (offene.length > 0) {
      const jetzt = new Date();
      await this.prisma.$transaction(
        async (tx) => {
          for (const p of offene) {
            await this.neueVersionen(tx, p.periode, regionCode, ForecastStatus.ABGESCHLOSSEN, aktor);
            await tx.forecastPeriode.update({ where: { id: p.id }, data: { status: ForecastStatus.ABGESCHLOSSEN, abgeschlossenAm: jetzt } });
            await this.audit.write(
              {
                entitaet: 'ForecastPeriode',
                entitaetId: p.id,
                aktion: 'STATUS_WECHSEL',
                userId: system ? null : aktor.id,
                userEmail: system ? 'SYSTEM' : aktor.email,
                vorherWert: { status: p.status },
                nachherWert: { status: 'ABGESCHLOSSEN' },
                metadaten: { ausgeloestDurch: periode, kaskadiert: p.periode !== periode, mitAbgeschlossen: abgeschlossen },
              },
              tx,
            );
          }
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
    }
    return { status: ForecastStatus.ABGESCHLOSSEN, abgeschlossen };
  }

  /**
   * F9: ABGESCHLOSSEN -> OFFEN (Vertriebsleiter/BU-Leiter/Admin, Begründung Pflicht). Kaskadiert auf alle
   * jüngeren abgeschlossenen Perioden derselben Region, damit kein offenes Loch zwischen abgeschlossenen
   * Monaten entsteht. Die eingefrorenen Werte bleiben erhalten und werden als neue OFFEN-Version angehängt.
   */
  async wiederOeffnen(periode: string, regionCode: string, aktor: RequestUser, begruendung: string) {
    const ziel = await this.ladePeriode(periode, regionCode);
    // Wirft 409 (Periode nicht abgeschlossen), 403 (Rolle) oder 422 (Begründung fehlt).
    this.sm.pruefe(FORECAST_TRANSITIONS, ziel.status, ForecastStatus.OFFEN, { rolle: aktor.rolle, aktorId: aktor.id, begruendung });
    const betroffene = await this.prisma.forecastPeriode.findMany({
      where: { regionCode, status: ForecastStatus.ABGESCHLOSSEN, ...ForecastService.abEinschliesslich(ziel) },
      orderBy: [{ jahr: 'desc' }, { monat: 'desc' }], // jüngste zuerst: Kette von hinten abbauen
    });
    const wiederGeoeffnet = betroffene.map((p) => p.periode);
    await this.prisma.$transaction(
      async (tx) => {
        for (const p of betroffene) {
          await this.neueVersionen(tx, p.periode, regionCode, ForecastStatus.OFFEN, aktor, undefined, begruendung);
          await tx.forecastPeriode.update({ where: { id: p.id }, data: { status: ForecastStatus.OFFEN, abgeschlossenAm: null } });
          await this.audit.write(
            {
              entitaet: 'ForecastPeriode',
              entitaetId: p.id,
              aktion: 'STATUS_WECHSEL',
              userId: aktor.id,
              userEmail: aktor.email,
              vorherWert: { status: 'ABGESCHLOSSEN', abgeschlossenAm: p.abgeschlossenAm },
              nachherWert: { status: 'OFFEN' },
              metadaten: { ausgeloestDurch: periode, kaskadiert: p.periode !== periode, mitGeoeffnet: wiederGeoeffnet, begruendung },
            },
            tx,
          );
        }
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    const agms = await this.aktiveAgms(regionCode);
    await Promise.all(
      agms.map((e) =>
        this.mail.send(
          e,
          infoMail(
            'Forecast wieder geöffnet',
            'Bearbeitung erneut möglich',
            `Region ${regionCode}, Perioden: ${wiederGeoeffnet.join(', ')}. Begründung: ${begruendung}`,
          ),
        ),
      ),
    );
    return { status: ForecastStatus.OFFEN, wiederGeoeffnet };
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
    // Bulk-Insert statt N Einzel-Inserts: bei der Abschluss-Kaskade laufen sonst hunderte Roundtrips
    // sequentiell in einer Transaktion.
    const rows = latest.map((v) => {
      const adj = adjust?.get(`${v.landId}|${v.e1Id}`);
      const mwNeu = adj ? mergeMonatsKommentar(v.monatswerteRest as unknown as MonatswerteRest, adj.mw) : v.monatswerteRest;
      return {
        periode,
        jahr: v.jahr,
        monat: v.monat,
        regionCode,
        landId: v.landId,
        e1Id: v.e1Id,
        monatswerteRest: mwNeu as Prisma.InputJsonValue,
        status,
        kommentar: kommentar ?? null,
        schwellwertVerletzt: adj?.verletzt ?? false,
        version: v.version + 1,
        userId: aktor.id,
      };
    });
    if (rows.length > 0) await tx.forecastVersion.createMany({ data: rows });
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
      this.prisma.istUmsatz.groupBy({ by: ['landId', 'e1Id', 'monat'], where: { jahr, monat: { lt: monat }, kostenstelleId: { in: ksts.map((k) => k.id) } }, _sum: { wertEur: true } }),
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
      // Offene Fremdüberschreibung durch die Leitung -> AGM muss zur Kenntnis nehmen.
      fremdaenderung: periodeInfo.fremdaenderungAm
        ? {
            am: periodeInfo.fremdaenderungAm,
            von: periodeInfo.fremdaenderungVon,
            begruendung: periodeInfo.fremdaenderungBegruendung,
            quittiertAm: periodeInfo.fremdaenderungQuittiertAm,
          }
        : null,
      zellen,
    };
  }

  /**
   * Vergleicht zwei Forecast-Stände (Perioden) einer Region und liefert die größten Umsatzabweichungen je Land.
   *  - 'YEE' (Standard): Jahres-Erwartung = Ist YTD (bis Periodenmonat) + Forecast-Rest. Neutralisiert die
   *    "abgelaufener Monat"-Verzerrung, weil vergangene Monate in beiden Ständen durch dasselbe Ist ersetzt werden.
   *  - 'RESTMONATE': reiner Forecast-Drift über die in BEIDEN Ständen prognostizierten (überlappenden) Monate.
   * Aggregiert je Land (Drilldown je Produktgruppe/E1), sortiert nach größter absoluter Abweichung.
   */
  async vergleich(
    periodeA: string,
    periodeB: string,
    regionCode: string,
    modus: 'YEE' | 'RESTMONATE',
    aktor: RequestUser,
  ) {
    await this.assertAgmRead(aktor, regionCode);
    const a = this.restMonate(periodeA);
    const b = this.restMonate(periodeB);
    if (a.jahr !== b.jahr) {
      throw new BadRequestException('Beide Perioden müssen dasselbe Forecast-Jahr betreffen.');
    }
    const jahr = a.jahr;
    const ueberlappAbMonat = Math.max(a.monat, b.monat); // erster in BEIDEN Ständen prognostizierte Restmonat
    const ksts = await this.prisma.kostenstelle.findMany({ where: { regionCode }, select: { id: true } });
    const kstIds = ksts.map((k) => k.id);
    const [latestA, latestB, istGrp, e1s, laender] = await Promise.all([
      this.latestVersionen(this.prisma, periodeA, regionCode),
      this.latestVersionen(this.prisma, periodeB, regionCode),
      this.prisma.istUmsatz.groupBy({
        by: ['landId', 'e1Id', 'monat'],
        where: { jahr, monat: { lt: ueberlappAbMonat }, kostenstelleId: { in: kstIds } },
        _sum: { wertEur: true },
      }),
      this.prisma.produktgruppeE1.findMany({ select: { id: true, nameDe: true } }),
      this.prisma.land.findMany({ select: { isoCode: true, nameDe: true } }),
    ]);
    const e1Name = new Map(e1s.map((e) => [e.id, e.nameDe]));
    const landName = new Map(laender.map((l) => [l.isoCode, l.nameDe]));

    // Ist je Zelle je Monat -> für YEE das YTD bis zum jeweiligen Periodenmonat des Stands.
    const istZelleMonat = new Map<string, Record<number, number>>();
    for (const g of istGrp) {
      const key = `${g.landId}|${g.e1Id}`;
      const rec = istZelleMonat.get(key) ?? {};
      rec[g.monat] = (rec[g.monat] ?? 0) + Number(g._sum.wertEur ?? 0);
      istZelleMonat.set(key, rec);
    }
    const istYtdBis = (key: string, monatExkl: number): number => {
      const rec = istZelleMonat.get(key);
      if (!rec) return 0;
      let s = 0;
      for (const [m, eur] of Object.entries(rec)) if (Number(m) < monatExkl) s += eur;
      return s;
    };
    const fcRest = (mw: MonatswerteRest): number => {
      if (modus !== 'RESTMONATE') return summeEur(mw);
      let s = 0;
      for (const [p, w] of Object.entries(mw)) {
        const parsed = parsePeriode(p);
        if (!parsed || parsed.jahr !== jahr || parsed.monat < ueberlappAbMonat) continue;
        s += w?.eur ?? 0;
      }
      return s;
    };
    const wertFor = (mw: MonatswerteRest, key: string, monatExkl: number): number =>
      modus === 'YEE' ? istYtdBis(key, monatExkl) + fcRest(mw) : fcRest(mw);

    const wertA = new Map<string, number>();
    const wertB = new Map<string, number>();
    for (const v of latestA) {
      const key = `${v.landId}|${v.e1Id}`;
      wertA.set(key, wertFor(v.monatswerteRest as unknown as MonatswerteRest, key, a.monat));
    }
    for (const v of latestB) {
      const key = `${v.landId}|${v.e1Id}`;
      wertB.set(key, wertFor(v.monatswerteRest as unknown as MonatswerteRest, key, b.monat));
    }

    // Union aller Zellen (Land×E1), je Land aggregieren, Drilldown je E1.
    const perLand = new Map<string, { wa: number; wb: number; e1: Map<string, { wa: number; wb: number }> }>();
    for (const key of new Set<string>([...wertA.keys(), ...wertB.keys()])) {
      const [landId, e1Id] = key.split('|');
      const wa = wertA.get(key) ?? 0;
      const wb = wertB.get(key) ?? 0;
      const l = perLand.get(landId) ?? { wa: 0, wb: 0, e1: new Map() };
      l.wa += wa;
      l.wb += wb;
      l.e1.set(e1Id, { wa, wb });
      perLand.set(landId, l);
    }

    const schwelle = await this.schwellwert();
    const ampelFor = (proz: number | null): 'grau' | 'rot' | 'gruen' =>
      proz === null ? 'grau' : Math.abs(proz) > schwelle ? 'rot' : 'gruen';

    const laenderOut = [...perLand.entries()]
      .map(([landId, l]) => ({
        landId,
        landName: landName.get(landId) ?? landId,
        wertA: l.wa,
        wertB: l.wb,
        abweichungEur: l.wb - l.wa,
        abweichungProzent: abwProz(l.wb, l.wa),
        ampel: ampelFor(abwProz(l.wb, l.wa)),
        produktgruppen: [...l.e1.entries()]
          .map(([e1Id, w]) => ({
            e1Id,
            e1Name: e1Name.get(e1Id) ?? e1Id,
            wertA: w.wa,
            wertB: w.wb,
            abweichungEur: w.wb - w.wa,
            abweichungProzent: abwProz(w.wb, w.wa),
          }))
          .sort((x, y) => Math.abs(y.abweichungEur) - Math.abs(x.abweichungEur)),
      }))
      .sort((x, y) => Math.abs(y.abweichungEur) - Math.abs(x.abweichungEur));

    const summeA = laenderOut.reduce((s, l) => s + l.wertA, 0);
    const summeB = laenderOut.reduce((s, l) => s + l.wertB, 0);
    return {
      periodeA,
      periodeB,
      regionCode,
      jahr,
      modus,
      ueberlappAbMonat: modus === 'RESTMONATE' ? ueberlappAbMonat : null,
      schwellwertProzent: schwelle,
      summe: { wertA: summeA, wertB: summeB, abweichungEur: summeB - summeA, abweichungProzent: abwProz(summeB, summeA) },
      laender: laenderOut,
    };
  }
}
