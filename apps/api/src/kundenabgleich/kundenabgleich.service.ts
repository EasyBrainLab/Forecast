import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomerSiteTyp } from '@prisma/client';
import { findeSiteKandidaten, type SiteKandidat } from '@forecast/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';

const TYP_WERTE: readonly CustomerSiteTyp[] = ['OEFFENTLICH', 'PRIVAT', 'UNBEKANNT'];

/** Verknüpfungsschlüssel eines D365-Kontos (Gesellschaft + Kundennummer), wie in CustomerSite.d365Konten gespeichert. */
function d365Key(dataAreaId: string, kundennummer: string): string {
  return `${dataAreaId}|${kundennummer}`;
}

export interface ZuordnenD365Input {
  dataAreaId: string;
  kundennummer: string;
  zielSiteId?: string | null;
  regionCode?: string | null;
  typ?: string;
}

/**
 * Kundenstamm-Abgleich: gleicht den importierten D365-Kundenstamm gegen den vorhandenen CustomerSite-Stamm ab.
 * Fuzzy-Match liefert nur Vorschläge — die Zuordnung wird stets manuell bestätigt (nie automatisch).
 */
@Injectable()
export class KundenabgleichService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private cleanTyp(t?: string): CustomerSiteTyp {
    return TYP_WERTE.includes((t ?? '') as CustomerSiteTyp) ? (t as CustomerSiteTyp) : 'UNBEKANNT';
  }

  private async zugeordneteKonten(): Promise<Set<string>> {
    const sites = await this.prisma.customerSite.findMany({ select: { d365Konten: true } });
    const set = new Set<string>();
    for (const s of sites) for (const k of s.d365Konten) set.add(k);
    return set;
  }

  /** Kennzahlen für die Abgleich-Übersicht. */
  async status() {
    const [kundenstamm, zugeordnet, rechnungsgruppen] = await Promise.all([
      this.prisma.kundenstamm.findMany({ select: { dataAreaId: true, kundennummer: true } }),
      this.zugeordneteKonten(),
      this.prisma.verkaufsrechnung.groupBy({ by: ['dataAreaId', 'kundennummer'], _count: { _all: true } }),
    ]);
    const stammKeys = new Set(kundenstamm.map((k) => d365Key(k.dataAreaId, k.kundennummer)));
    const verknuepft = kundenstamm.filter((k) => zugeordnet.has(d365Key(k.dataAreaId, k.kundennummer))).length;
    const rechnungskundenOhneStamm = rechnungsgruppen.filter((g) => !stammKeys.has(d365Key(g.dataAreaId, g.kundennummer))).length;
    return {
      kundenstammGesamt: kundenstamm.length,
      verknuepft,
      offen: kundenstamm.length - verknuepft,
      rechnungskundenGesamt: rechnungsgruppen.length,
      rechnungskundenOhneStamm,
    };
  }

  /** Noch nicht zugeordnete D365-Kunden mit Fuzzy-Match-Vorschlägen gegen bestehende CustomerSites. */
  async vorschlaege(limit = 200) {
    const sites = await this.prisma.customerSite.findMany({ select: { id: true, name: true } });
    const kandidaten: SiteKandidat[] = sites.map((s) => ({ id: s.id, name: s.name }));
    const zugeordnet = await this.zugeordneteKonten();
    const kundenstamm = await this.prisma.kundenstamm.findMany({
      select: { dataAreaId: true, kundennummer: true, name: true, stadt: true, landIso: true, kundengruppe: true },
      orderBy: { name: 'asc' },
    });
    const offen = kundenstamm.filter((k) => !zugeordnet.has(d365Key(k.dataAreaId, k.kundennummer)));
    return {
      offenGesamt: offen.length,
      vorschlaege: offen.slice(0, limit).map((k) => ({
        dataAreaId: k.dataAreaId,
        kundennummer: k.kundennummer,
        name: k.name,
        stadt: k.stadt,
        landIso: k.landIso,
        kundengruppe: k.kundengruppe,
        matches: findeSiteKandidaten(k.name, kandidaten, 0.5, 5),
      })),
    };
  }

  /** Bestätigt eine Zuordnung: verknüpft das D365-Konto mit einer bestehenden CustomerSite ODER legt eine neue an. */
  async zuordnen(input: ZuordnenD365Input, aktor: RequestUser) {
    const dataAreaId = String(input.dataAreaId ?? '').trim();
    const kundennummer = String(input.kundennummer ?? '').trim();
    if (!dataAreaId || !kundennummer) throw new BadRequestException('dataAreaId und kundennummer sind erforderlich.');
    const stamm = await this.prisma.kundenstamm.findUnique({ where: { dataAreaId_kundennummer: { dataAreaId, kundennummer } } });
    if (!stamm) throw new NotFoundException('Kundenstamm-Eintrag nicht gefunden.');
    const key = d365Key(dataAreaId, kundennummer);

    if (input.zielSiteId) {
      const site = await this.prisma.customerSite.findUnique({ where: { id: input.zielSiteId } });
      if (!site) throw new NotFoundException('Ziel-Standort nicht gefunden.');
      if (site.d365Konten.includes(key)) return site; // idempotent
      const updated = await this.prisma.customerSite.update({ where: { id: site.id }, data: { d365Konten: { push: key } } });
      await this.audit.write({ entitaet: 'CustomerSite', entitaetId: site.id, aktion: 'UPDATE', userId: aktor.id, userEmail: aktor.email, metadaten: { d365KontoZugeordnet: key, name: stamm.name } });
      return updated;
    }

    const created = await this.prisma.customerSite.create({
      data: {
        name: stamm.name.slice(0, 200),
        stadt: stamm.stadt ? stamm.stadt.slice(0, 120) : null,
        landIso: stamm.landIso ? stamm.landIso.slice(0, 8) : null,
        regionCode: input.regionCode ? String(input.regionCode).trim() : null,
        typ: this.cleanTyp(input.typ),
        status: 'NEU',
        d365Konten: [key],
      },
    });
    await this.audit.write({ entitaet: 'CustomerSite', entitaetId: created.id, aktion: 'CREATE', userId: aktor.id, userEmail: aktor.email, metadaten: { ausD365Konto: key, name: stamm.name } });
    return created;
  }

  /**
   * Rechnungskunden, die (noch) nicht im D365-Kundenstamm stehen — v. a. Intercompany- und Altkonten.
   * Reine Sichtung; enthält kein Name (Rechnungen tragen nur die Kundennummer).
   */
  async rechnungskundenOhneStamm(limit = 300) {
    const [stamm, gruppen] = await Promise.all([
      this.prisma.kundenstamm.findMany({ select: { dataAreaId: true, kundennummer: true } }),
      this.prisma.verkaufsrechnung.groupBy({
        by: ['dataAreaId', 'kundennummer'],
        _count: { _all: true },
        _min: { rechnungsdatum: true },
        _max: { rechnungsdatum: true },
      }),
    ]);
    const stammKeys = new Set(stamm.map((k) => d365Key(k.dataAreaId, k.kundennummer)));
    const offen = gruppen
      .filter((g) => !stammKeys.has(d365Key(g.dataAreaId, g.kundennummer)))
      .sort((a, b) => b._count._all - a._count._all)
      .slice(0, limit)
      .map((g) => ({
        dataAreaId: g.dataAreaId,
        kundennummer: g.kundennummer,
        anzahlRechnungen: g._count._all,
        datumVon: g._min.rechnungsdatum,
        datumBis: g._max.rechnungsdatum,
      }));
    return { gesamt: offen.length, kunden: offen };
  }
}
