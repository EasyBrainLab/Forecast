import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomerSite, CustomerSiteStatus, CustomerSiteTyp, Prisma } from '@prisma/client';
import { findeSiteKandidaten, type SiteKandidat } from '@forecast/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../scope/scope.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';

const TYP_WERTE: readonly CustomerSiteTyp[] = ['OEFFENTLICH', 'PRIVAT', 'UNBEKANNT'];
const STATUS_WERTE: readonly CustomerSiteStatus[] = ['NEU', 'AKTIV', 'GEFAEHRDET', 'VERLOREN', 'ZURUECKGEWONNEN'];

export interface SiteInput {
  name?: string;
  stadt?: string | null;
  landIso?: string | null;
  regionCode?: string | null;
  typ?: string;
  status?: string;
  notiz?: string | null;
}

/** Bestätigung eines Fuzzy-Match-Vorschlags: entweder bestehender Site zuordnen (zielSiteId) oder neu anlegen. */
export interface ZuordnenInput {
  kunde?: string;
  zielSiteId?: string | null;
  regionCode?: string | null;
  typ?: string;
  stadt?: string | null;
  landIso?: string | null;
}

@Injectable()
export class CustomerSiteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  private cleanTyp(t?: string): CustomerSiteTyp {
    return TYP_WERTE.includes((t ?? '') as CustomerSiteTyp) ? (t as CustomerSiteTyp) : 'UNBEKANNT';
  }
  private cleanStatus(s?: string): CustomerSiteStatus | undefined {
    return STATUS_WERTE.includes((s ?? '') as CustomerSiteStatus) ? (s as CustomerSiteStatus) : undefined;
  }

  private async leseWhere(aktor: RequestUser): Promise<Prisma.CustomerSiteWhereInput> {
    const scope = await this.scope.getScope(aktor);
    return this.scope.regionWhere(scope) as Prisma.CustomerSiteWhereInput;
  }

  private async assertRegionSchreibbar(aktor: RequestUser, regionCode: string | null): Promise<void> {
    if (aktor.rolle !== 'AGM') return;
    const scope = await this.scope.getScope(aktor);
    if (!regionCode) throw new BadRequestException('AGM müssen dem Standort eine eigene Region zuordnen.');
    this.scope.assertSchreibScope(scope, regionCode);
  }

  private toDto(s: CustomerSite) {
    return {
      id: s.id,
      name: s.name,
      stadt: s.stadt,
      landIso: s.landIso,
      regionCode: s.regionCode,
      typ: s.typ,
      status: s.status,
      notiz: s.notiz,
      quellNamen: s.quellNamen,
      erstelltAm: s.erstelltAm,
      aktualisiertAm: s.aktualisiertAm,
    };
  }

  // ─────────── Lesen ───────────

  async liste(aktor: RequestUser, status?: string) {
    const where = await this.leseWhere(aktor);
    if (status && (STATUS_WERTE as readonly string[]).includes(status)) where.status = status as CustomerSiteStatus;
    const rows = await this.prisma.customerSite.findMany({ where, orderBy: [{ name: 'asc' }] });
    return rows.map((s) => this.toDto(s));
  }

  async holen(id: string, aktor: RequestUser) {
    const s = await this.prisma.customerSite.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Standort nicht gefunden.');
    const scope = await this.scope.getScope(aktor);
    if (!scope.unbeschraenkt && (s.regionCode == null || !scope.regionCodes.includes(s.regionCode))) {
      throw new ForbiddenException('Kein Zugriff auf diesen Standort.');
    }
    return this.toDto(s);
  }

  // ─────────── Stammdaten-Pflege ───────────

  async erstellen(input: SiteInput, aktor: RequestUser) {
    const name = String(input.name ?? '').trim();
    if (!name) throw new BadRequestException('Name ist erforderlich.');
    const created = await this.prisma.customerSite.create({
      data: {
        name: name.slice(0, 200),
        stadt: input.stadt ? String(input.stadt).slice(0, 120) : null,
        landIso: input.landIso ? String(input.landIso).slice(0, 8) : null,
        regionCode: input.regionCode ? String(input.regionCode).trim() : null,
        typ: this.cleanTyp(input.typ),
        status: this.cleanStatus(input.status) ?? 'NEU',
        notiz: input.notiz ? String(input.notiz).slice(0, 4000) : null,
      },
    });
    await this.audit.write({ entitaet: 'CustomerSite', entitaetId: created.id, aktion: 'CREATE', userId: aktor.id, userEmail: aktor.email, metadaten: { name } });
    return this.toDto(created);
  }

  async aktualisieren(id: string, input: SiteInput, aktor: RequestUser) {
    const vorhanden = await this.prisma.customerSite.findUnique({ where: { id } });
    if (!vorhanden) throw new NotFoundException('Standort nicht gefunden.');
    // Whitelist-PATCH.
    const data: Prisma.CustomerSiteUncheckedUpdateInput = {};
    if (input.name !== undefined) {
      const n = String(input.name).trim();
      if (!n) throw new BadRequestException('Name darf nicht leer sein.');
      data.name = n.slice(0, 200);
    }
    if (input.stadt !== undefined) data.stadt = input.stadt ? String(input.stadt).slice(0, 120) : null;
    if (input.landIso !== undefined) data.landIso = input.landIso ? String(input.landIso).slice(0, 8) : null;
    if (input.regionCode !== undefined) data.regionCode = input.regionCode ? String(input.regionCode).trim() : null;
    if (input.typ !== undefined) data.typ = this.cleanTyp(input.typ);
    if (input.status !== undefined) {
      const st = this.cleanStatus(input.status);
      if (!st) throw new BadRequestException('Ungültiger Status.');
      data.status = st;
    }
    if (input.notiz !== undefined) data.notiz = input.notiz ? String(input.notiz).slice(0, 4000) : null;
    const result = await this.prisma.customerSite.update({ where: { id }, data });
    await this.audit.write({ entitaet: 'CustomerSite', entitaetId: id, aktion: 'UPDATE', userId: aktor.id, userEmail: aktor.email, metadaten: { felder: Object.keys(data) } });
    return this.toDto(result);
  }

  /** Status-Workflow (aktiv/gefährdet/verloren/zurückgewonnen) — AGM nur für die eigene Region. */
  async statusSetzen(id: string, status: string, aktor: RequestUser) {
    const st = this.cleanStatus(status);
    if (!st) throw new BadRequestException('Ungültiger Status.');
    const vorhanden = await this.prisma.customerSite.findUnique({ where: { id } });
    if (!vorhanden) throw new NotFoundException('Standort nicht gefunden.');
    await this.assertRegionSchreibbar(aktor, vorhanden.regionCode);
    const result = await this.prisma.customerSite.update({ where: { id }, data: { status: st } });
    await this.audit.write({ entitaet: 'CustomerSite', entitaetId: id, aktion: 'STATUS_WECHSEL', userId: aktor.id, userEmail: aktor.email, vorherWert: { status: vorhanden.status }, nachherWert: { status: st } });
    return this.toDto(result);
  }

  async loeschen(id: string, aktor: RequestUser) {
    const vorhanden = await this.prisma.customerSite.findUnique({ where: { id } });
    if (!vorhanden) throw new NotFoundException('Standort nicht gefunden.');
    await this.prisma.customerSite.delete({ where: { id } });
    await this.audit.write({ entitaet: 'CustomerSite', entitaetId: id, aktion: 'DELETE', userId: aktor.id, userEmail: aktor.email, vorherWert: { name: vorhanden.name } });
    return { geloescht: true };
  }

  // ─────────── Fuzzy-Match-Bestätigungs-Workflow ───────────

  /**
   * Liefert noch nicht zugeordnete `Absatz.kunde`-Strings mit Match-Vorschlägen gegen bestehende Standorte
   * plus einem Region-Vorschlag (aus KundeRegion oder Absatz). Nur Vorschläge — keine automatische Zuordnung.
   */
  async vorschlaege(limit = 200) {
    const sites = await this.prisma.customerSite.findMany({ select: { id: true, name: true, quellNamen: true } });
    const zugeordnet = new Set<string>();
    for (const s of sites) for (const q of s.quellNamen) zugeordnet.add(q);
    const kandidaten: SiteKandidat[] = sites.map((s) => ({ id: s.id, name: s.name }));

    const absatzKunden = await this.prisma.absatz.findMany({
      distinct: ['kunde'],
      select: { kunde: true, stadt: true, landId: true, regionCode: true },
      orderBy: { kunde: 'asc' },
    });
    const kundeRegionen = await this.prisma.kundeRegion.findMany();
    const krMap = new Map(kundeRegionen.map((k) => [k.kunde, k.regionCode]));

    const offen = absatzKunden.filter((a) => !zugeordnet.has(a.kunde));
    return {
      offenGesamt: offen.length,
      vorschlaege: offen.slice(0, limit).map((a) => ({
        kunde: a.kunde,
        stadt: a.stadt,
        landIso: a.landId,
        regionVorschlag: krMap.get(a.kunde) ?? a.regionCode ?? null,
        matches: findeSiteKandidaten(a.kunde, kandidaten, 0.5, 5),
      })),
    };
  }

  private async regionAusKunde(kunde: string): Promise<string | null> {
    const kr = await this.prisma.kundeRegion.findUnique({ where: { kunde } });
    if (kr) return kr.regionCode;
    const a = await this.prisma.absatz.findFirst({ where: { kunde }, select: { regionCode: true } });
    return a?.regionCode ?? null;
  }

  /** Bestätigt einen Vorschlag: hängt den Kunde-String an eine bestehende Site an ODER legt eine neue an. */
  async zuordnen(input: ZuordnenInput, aktor: RequestUser) {
    const kunde = String(input.kunde ?? '').trim();
    if (!kunde) throw new BadRequestException('Kunde/Quellname ist erforderlich.');

    if (input.zielSiteId) {
      const site = await this.prisma.customerSite.findUnique({ where: { id: input.zielSiteId } });
      if (!site) throw new NotFoundException('Ziel-Standort nicht gefunden.');
      if (site.quellNamen.includes(kunde)) return this.toDto(site); // idempotent
      const updated = await this.prisma.customerSite.update({ where: { id: site.id }, data: { quellNamen: { push: kunde } } });
      await this.audit.write({ entitaet: 'CustomerSite', entitaetId: site.id, aktion: 'UPDATE', userId: aktor.id, userEmail: aktor.email, metadaten: { zugeordnet: kunde } });
      return this.toDto(updated);
    }

    const regionCode = input.regionCode ? String(input.regionCode).trim() : await this.regionAusKunde(kunde);
    const created = await this.prisma.customerSite.create({
      data: {
        name: kunde.slice(0, 200),
        stadt: input.stadt ? String(input.stadt).slice(0, 120) : null,
        landIso: input.landIso ? String(input.landIso).slice(0, 8) : null,
        regionCode,
        typ: this.cleanTyp(input.typ),
        status: 'NEU',
        quellNamen: [kunde],
      },
    });
    await this.audit.write({ entitaet: 'CustomerSite', entitaetId: created.id, aktion: 'CREATE', userId: aktor.id, userEmail: aktor.email, metadaten: { ausKunde: kunde, regionCode } });
    return this.toDto(created);
  }
}
