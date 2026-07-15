import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type Richtung = 'steigerung' | 'rueckgang' | 'beide';

const clamp = (n: number, min: number, max: number, def: number): number => (Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def);

/**
 * Kuratierter Auswertungskatalog über die D365-Rechnungspositionen. Alle Methoden filtern auf eine
 * Währung (Default EUR) — Fremdwährung wird nie vermischt. Umsatz = Netto (Summe betrag inkl. Gutschriften).
 * Kunden-Identität = (dataAreaId, kundennummer), konsistent zu Kundenstamm und CustomerSite.d365Konten.
 */
@Injectable()
export class SalesAnalytikService {
  constructor(private readonly prisma: PrismaService) {}

  private async kundennameMap(): Promise<Map<string, string>> {
    const rows = await this.prisma.kundenstamm.findMany({ select: { dataAreaId: true, kundennummer: true, name: true } });
    return new Map(rows.map((r) => [`${r.dataAreaId}|${r.kundennummer}`, r.name]));
  }
  private name(map: Map<string, string>, dataAreaId: string, kundennummer: string): string | null {
    return map.get(`${dataAreaId}|${kundennummer}`) ?? null;
  }

  /** Filter-Optionen für die UI: verfügbare Jahre und Währungen. */
  async filteroptionen(): Promise<{ jahre: number[]; waehrungen: { waehrung: string; anzahl: number }[] }> {
    const jahre = await this.prisma.$queryRaw<{ jahr: number }[]>`
      SELECT DISTINCT EXTRACT(YEAR FROM rechnungsdatum)::int AS jahr
      FROM verkaufsrechnung_position ORDER BY jahr DESC`;
    const waehrungen = await this.prisma.$queryRaw<{ waehrung: string; anzahl: number }[]>`
      SELECT waehrung, COUNT(*)::int AS anzahl
      FROM verkaufsrechnung_position GROUP BY waehrung ORDER BY anzahl DESC`;
    return { jahre: jahre.map((j) => j.jahr), waehrungen };
  }

  /** Kundenliste (aus dem Stamm) für Filter/Picker. */
  async kunden(): Promise<{ dataAreaId: string; kundennummer: string; name: string }[]> {
    return this.prisma.kundenstamm.findMany({
      select: { dataAreaId: true, kundennummer: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  /** Produktliste (aus den Positionen) für Filter/Picker. */
  async produkte(): Promise<{ produktnummer: string; produktname: string | null; anzahl: number }[]> {
    return this.prisma.$queryRaw`
      SELECT produktnummer, MAX(produktname) AS produktname, COUNT(*)::int AS anzahl
      FROM verkaufsrechnung_position
      WHERE produktnummer IS NOT NULL
      GROUP BY produktnummer ORDER BY produktnummer ASC`;
  }

  /**
   * Preisstabilität: Kunden, die für ein Produkt über ≥ `jahre` Jahre denselben Preis zahlen
   * (Schwankung ≤ `toleranzProzent` %). Gutschriften/0-Preise ausgeschlossen.
   */
  async preisstabilitaet(opt: { jahre?: number; toleranzProzent?: number; produktnummer?: string; waehrung?: string; limit?: number }) {
    const jahre = clamp(Number(opt.jahre), 1, 20, 3);
    const tol = clamp(Number(opt.toleranzProzent), 0, 50, 0);
    const limit = clamp(Number(opt.limit), 1, 200, 50);
    const waehrung = (opt.waehrung || 'EUR').toUpperCase();
    const produktFilter = opt.produktnummer ? Prisma.sql`AND produktnummer = ${opt.produktnummer}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      { dataAreaId: string; kundennummer: string; produktnummer: string; produktname: string | null; minpreis: number; maxpreis: number; erste: Date; letzte: Date; anzahl: number }[]
    >`
      SELECT "dataAreaId", kundennummer, produktnummer, MAX(produktname) AS produktname,
             MIN(verkaufspreis)::float8 AS minpreis, MAX(verkaufspreis)::float8 AS maxpreis,
             MIN(rechnungsdatum) AS erste, MAX(rechnungsdatum) AS letzte, COUNT(*)::int AS anzahl
      FROM verkaufsrechnung_position
      WHERE waehrung = ${waehrung} AND verkaufspreis > 0 AND produktnummer IS NOT NULL ${produktFilter}
      GROUP BY "dataAreaId", kundennummer, produktnummer
      HAVING COUNT(*) >= 2
         AND (MAX(verkaufspreis) - MIN(verkaufspreis)) <= MIN(verkaufspreis) * ${tol}::float8 / 100.0
         AND EXTRACT(EPOCH FROM (MAX(rechnungsdatum) - MIN(rechnungsdatum))) >= ${jahre}::float8 * 31536000
      ORDER BY (MAX(rechnungsdatum) - MIN(rechnungsdatum)) DESC
      LIMIT ${limit}`;
    const map = await this.kundennameMap();
    return {
      typ: 'preisstabilitaet' as const,
      parameter: { jahre, toleranzProzent: tol, produktnummer: opt.produktnummer ?? null, waehrung },
      zeilen: rows.map((r) => ({
        dataAreaId: r.dataAreaId,
        kundennummer: r.kundennummer,
        kundenname: this.name(map, r.dataAreaId, r.kundennummer),
        produktnummer: r.produktnummer,
        produktname: r.produktname,
        preis: r.minpreis,
        preisSchwankung: Math.round((r.maxpreis - r.minpreis) * 10000) / 10000,
        jahreSpanne: Math.round(((r.letzte.getTime() - r.erste.getTime()) / 31536000000) * 10) / 10,
        ersteRechnung: r.erste,
        letzteRechnung: r.letzte,
        anzahlRechnungen: r.anzahl,
      })),
    };
  }

  /** Umsatzveränderung je Kunde zwischen zwei Jahren (Ranking Steigerung/Rückgang). */
  async umsatzveraenderung(opt: { jahrVon: number; jahrBis: number; richtung?: Richtung; waehrung?: string; limit?: number }) {
    const jahrVon = clamp(Number(opt.jahrVon), 2000, 2100, 2020);
    const jahrBis = clamp(Number(opt.jahrBis), 2000, 2100, 2026);
    const limit = clamp(Number(opt.limit), 1, 200, 25);
    const richtung: Richtung = ['steigerung', 'rueckgang', 'beide'].includes(opt.richtung as string) ? (opt.richtung as Richtung) : 'beide';
    const waehrung = (opt.waehrung || 'EUR').toUpperCase();
    const rows = await this.prisma.$queryRaw<{ dataAreaId: string; kundennummer: string; von: number; bis: number }[]>`
      SELECT "dataAreaId", kundennummer,
             COALESCE(SUM(betrag) FILTER (WHERE EXTRACT(YEAR FROM rechnungsdatum) = ${jahrVon}), 0)::float8 AS von,
             COALESCE(SUM(betrag) FILTER (WHERE EXTRACT(YEAR FROM rechnungsdatum) = ${jahrBis}), 0)::float8 AS bis
      FROM verkaufsrechnung_position
      WHERE waehrung = ${waehrung} AND EXTRACT(YEAR FROM rechnungsdatum) IN (${jahrVon}, ${jahrBis})
      GROUP BY "dataAreaId", kundennummer`;
    const map = await this.kundennameMap();
    let ergebnis = rows.map((r) => {
      const delta = r.bis - r.von;
      return {
        dataAreaId: r.dataAreaId,
        kundennummer: r.kundennummer,
        kundenname: this.name(map, r.dataAreaId, r.kundennummer),
        umsatzVon: Math.round(r.von * 100) / 100,
        umsatzBis: Math.round(r.bis * 100) / 100,
        deltaEur: Math.round(delta * 100) / 100,
        deltaProzent: r.von !== 0 ? Math.round((delta / Math.abs(r.von)) * 1000) / 10 : null,
      };
    });
    if (richtung === 'steigerung') ergebnis = ergebnis.filter((e) => e.deltaEur > 0).sort((a, b) => b.deltaEur - a.deltaEur);
    else if (richtung === 'rueckgang') ergebnis = ergebnis.filter((e) => e.deltaEur < 0).sort((a, b) => a.deltaEur - b.deltaEur);
    else ergebnis = ergebnis.sort((a, b) => Math.abs(b.deltaEur) - Math.abs(a.deltaEur));
    return { typ: 'umsatzveraenderung' as const, parameter: { jahrVon, jahrBis, richtung, waehrung }, zeilen: ergebnis.slice(0, limit) };
  }

  /** Zeitreihe (Umsatz/Menge/Ø-Preis je Jahr) für einen Kunden, optional je Produkt. */
  async kundenzeitreihe(opt: { dataAreaId: string; kundennummer: string; produktnummer?: string; waehrung?: string }) {
    const waehrung = (opt.waehrung || 'EUR').toUpperCase();
    const produktFilter = opt.produktnummer ? Prisma.sql`AND produktnummer = ${opt.produktnummer}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<{ jahr: number; umsatz: number; menge: number }[]>`
      SELECT EXTRACT(YEAR FROM rechnungsdatum)::int AS jahr, SUM(betrag)::float8 AS umsatz, SUM(menge)::float8 AS menge
      FROM verkaufsrechnung_position
      WHERE waehrung = ${waehrung} AND "dataAreaId" = ${opt.dataAreaId} AND kundennummer = ${opt.kundennummer} ${produktFilter}
      GROUP BY jahr ORDER BY jahr ASC`;
    const map = await this.kundennameMap();
    return {
      typ: 'kundenzeitreihe' as const,
      parameter: { dataAreaId: opt.dataAreaId, kundennummer: opt.kundennummer, kundenname: this.name(map, opt.dataAreaId, opt.kundennummer), produktnummer: opt.produktnummer ?? null, waehrung },
      zeilen: rows.map((r) => ({
        jahr: r.jahr,
        umsatz: Math.round(r.umsatz * 100) / 100,
        menge: Math.round(r.menge * 100) / 100,
        durchschnittspreis: r.menge !== 0 ? Math.round((r.umsatz / r.menge) * 10000) / 10000 : null,
      })),
    };
  }

  /** Mengenveränderung zwischen zwei Jahren, je Kunde oder je Produkt (Ranking). */
  async mengentrend(opt: { jahrVon: number; jahrBis: number; dimension?: 'kunde' | 'produkt'; richtung?: Richtung; waehrung?: string; limit?: number }) {
    const jahrVon = clamp(Number(opt.jahrVon), 2000, 2100, 2020);
    const jahrBis = clamp(Number(opt.jahrBis), 2000, 2100, 2026);
    const limit = clamp(Number(opt.limit), 1, 200, 25);
    const dimension: 'kunde' | 'produkt' = opt.dimension === 'produkt' ? 'produkt' : 'kunde';
    const richtung: Richtung = ['steigerung', 'rueckgang', 'beide'].includes(opt.richtung as string) ? (opt.richtung as Richtung) : 'beide';
    const waehrung = (opt.waehrung || 'EUR').toUpperCase();

    let ergebnis: { schluessel: string; label: string | null; mengeVon: number; mengeBis: number; deltaMenge: number; deltaProzent: number | null }[];
    if (dimension === 'produkt') {
      const rows = await this.prisma.$queryRaw<{ produktnummer: string; produktname: string | null; von: number; bis: number }[]>`
        SELECT produktnummer, MAX(produktname) AS produktname,
               COALESCE(SUM(menge) FILTER (WHERE EXTRACT(YEAR FROM rechnungsdatum) = ${jahrVon}), 0)::float8 AS von,
               COALESCE(SUM(menge) FILTER (WHERE EXTRACT(YEAR FROM rechnungsdatum) = ${jahrBis}), 0)::float8 AS bis
        FROM verkaufsrechnung_position
        WHERE waehrung = ${waehrung} AND produktnummer IS NOT NULL AND EXTRACT(YEAR FROM rechnungsdatum) IN (${jahrVon}, ${jahrBis})
        GROUP BY produktnummer`;
      ergebnis = rows.map((r) => ({ schluessel: r.produktnummer, label: r.produktname, mengeVon: r.von, mengeBis: r.bis, deltaMenge: r.bis - r.von, deltaProzent: r.von !== 0 ? Math.round(((r.bis - r.von) / Math.abs(r.von)) * 1000) / 10 : null }));
    } else {
      const rows = await this.prisma.$queryRaw<{ dataAreaId: string; kundennummer: string; von: number; bis: number }[]>`
        SELECT "dataAreaId", kundennummer,
               COALESCE(SUM(menge) FILTER (WHERE EXTRACT(YEAR FROM rechnungsdatum) = ${jahrVon}), 0)::float8 AS von,
               COALESCE(SUM(menge) FILTER (WHERE EXTRACT(YEAR FROM rechnungsdatum) = ${jahrBis}), 0)::float8 AS bis
        FROM verkaufsrechnung_position
        WHERE waehrung = ${waehrung} AND EXTRACT(YEAR FROM rechnungsdatum) IN (${jahrVon}, ${jahrBis})
        GROUP BY "dataAreaId", kundennummer`;
      const map = await this.kundennameMap();
      ergebnis = rows.map((r) => ({ schluessel: `${r.dataAreaId}|${r.kundennummer}`, label: this.name(map, r.dataAreaId, r.kundennummer), mengeVon: r.von, mengeBis: r.bis, deltaMenge: r.bis - r.von, deltaProzent: r.von !== 0 ? Math.round(((r.bis - r.von) / Math.abs(r.von)) * 1000) / 10 : null }));
    }
    if (richtung === 'steigerung') ergebnis = ergebnis.filter((e) => e.deltaMenge > 0).sort((a, b) => b.deltaMenge - a.deltaMenge);
    else if (richtung === 'rueckgang') ergebnis = ergebnis.filter((e) => e.deltaMenge < 0).sort((a, b) => a.deltaMenge - b.deltaMenge);
    else ergebnis = ergebnis.sort((a, b) => Math.abs(b.deltaMenge) - Math.abs(a.deltaMenge));
    return {
      typ: 'mengentrend' as const,
      parameter: { jahrVon, jahrBis, dimension, richtung, waehrung },
      zeilen: ergebnis.slice(0, limit).map((e) => ({ ...e, mengeVon: Math.round(e.mengeVon * 100) / 100, mengeBis: Math.round(e.mengeBis * 100) / 100, deltaMenge: Math.round(e.deltaMenge * 100) / 100 })),
    };
  }
}
