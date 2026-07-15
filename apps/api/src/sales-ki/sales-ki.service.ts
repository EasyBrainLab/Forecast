import { Injectable } from '@nestjs/common';
import { nameAehnlichkeit, normalizeSiteName } from '@forecast/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SalesAnalytikService } from '../sales-analytik/sales-analytik.service';
import { SalesFrageProvider, type AnalyseTyp } from './sales-frage.provider';

export interface FrageAntwort {
  analyseTyp: AnalyseTyp;
  erklaerung: string;
  antwort: string; // knappe natürlichsprachige Zusammenfassung des Ergebnisses
  aufloesung: Record<string, unknown>; // wie Kunden-/Produktsuche aufgelöst wurde
  ergebnis: { typ: string; parameter: Record<string, unknown>; zeilen: Record<string, unknown>[] } | null;
}

const keur = (v: number): string => `${(v / 1000).toLocaleString('de-DE', { maximumFractionDigits: 0 })} kEUR`;

@Injectable()
export class SalesKiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytik: SalesAnalytikService,
    private readonly frage: SalesFrageProvider,
  ) {}

  /** Löst einen Produkt-Suchtext auf die beste Produktnummer auf (Enthält-Match auf Nummer/Name). */
  private async findeProdukt(suche: string | null): Promise<{ produktnummer: string; produktname: string | null } | null> {
    if (!suche) return null;
    const q = normalizeSiteName(suche);
    if (!q) return null;
    const produkte = await this.analytik.produkte();
    const treffer = produkte.filter((p) => normalizeSiteName(`${p.produktnummer} ${p.produktname ?? ''}`).includes(q));
    if (treffer.length === 0) return null;
    treffer.sort((a, b) => b.anzahl - a.anzahl);
    return { produktnummer: treffer[0].produktnummer, produktname: treffer[0].produktname };
  }

  /** Löst einen Kunden-Suchtext auf (dataAreaId, kundennummer) auf (exakte Nummer, Enthält- oder Fuzzy-Namensmatch). */
  private async findeKunde(suche: string | null): Promise<{ dataAreaId: string; kundennummer: string; name: string } | null> {
    if (!suche) return null;
    const kunden = await this.prisma.kundenstamm.findMany({ select: { dataAreaId: true, kundennummer: true, name: true } });
    const nummer = kunden.find((k) => k.kundennummer.toLowerCase() === suche.trim().toLowerCase());
    if (nummer) return nummer;
    const q = normalizeSiteName(suche);
    const enthaelt = kunden.filter((k) => normalizeSiteName(k.name).includes(q));
    if (enthaelt.length > 0) {
      enthaelt.sort((a, b) => nameAehnlichkeit(suche, b.name) - nameAehnlichkeit(suche, a.name));
      return enthaelt[0];
    }
    // Fallback: aussagekräftigste Tokens des Suchbegriffs (ohne Füllwörter) einzeln matchen.
    const STOP = new Set(['ueber', 'uber', 'die', 'der', 'das', 'den', 'jahre', 'jahren', 'des', 'von', 'fuer', 'im', 'in', 'und', 'zum', 'zur']);
    const token = q.split(' ').filter((w) => w.length >= 3 && !STOP.has(w)).sort((a, b) => b.length - a.length);
    for (const tk of token) {
      const treffer = kunden.filter((k) => normalizeSiteName(k.name).includes(tk));
      if (treffer.length > 0) {
        treffer.sort((a, b) => nameAehnlichkeit(suche, b.name) - nameAehnlichkeit(suche, a.name));
        return treffer[0];
      }
    }
    let best: { k: (typeof kunden)[number]; score: number } | null = null;
    for (const k of kunden) {
      const score = nameAehnlichkeit(suche, k.name);
      if (!best || score > best.score) best = { k, score };
    }
    return best && best.score >= 0.4 ? best.k : null;
  }

  async beantworte(frageText: string): Promise<FrageAntwort> {
    const fo = await this.analytik.filteroptionen();
    const jahrMin = fo.jahre.length ? Math.min(...fo.jahre) : 2020;
    const jahrMax = fo.jahre.length ? Math.max(...fo.jahre) : 2026;
    const route = await this.frage.route(frageText, jahrMin, jahrMax);
    const p = route.parameter;
    const aufloesung: Record<string, unknown> = {};

    if (route.analyseTyp === 'unbekannt') {
      return {
        analyseTyp: 'unbekannt',
        erklaerung: route.erklaerung,
        antwort: 'Die Frage ließ sich keiner Auswertung zuordnen. Formulieren Sie sie z. B. als „Welche Kunden zahlen seit über 3 Jahren denselben Preis?", „Wer hat den größten Umsatzrückgang von 2022 zu 2025?" oder „Umsatzentwicklung des Kunden … über die Jahre".',
        aufloesung,
        ergebnis: null,
      };
    }

    const produkt = await this.findeProdukt(p.produktSuche);
    if (p.produktSuche) aufloesung.produkt = produkt ? `${produkt.produktnummer} — ${produkt.produktname ?? ''}` : `„${p.produktSuche}" nicht gefunden`;

    if (route.analyseTyp === 'preisstabilitaet') {
      const erg = await this.analytik.preisstabilitaet({ jahre: p.jahre ?? 3, toleranzProzent: p.toleranzProzent ?? 0, produktnummer: produkt?.produktnummer, waehrung: p.waehrung ?? 'EUR' });
      const antwort = `${erg.zeilen.length} Kunden-Produkt-Kombinationen zahlen seit ≥ ${erg.parameter.jahre} Jahren denselben Preis${produkt ? ` für ${produkt.produktname ?? produkt.produktnummer}` : ''}.` +
        (erg.zeilen[0] ? ` Beispiel: ${erg.zeilen[0].kundenname ?? erg.zeilen[0].kundennummer} — ${erg.zeilen[0].preis} ${erg.parameter.waehrung} über ${erg.zeilen[0].jahreSpanne} Jahre.` : '');
      return { analyseTyp: route.analyseTyp, erklaerung: route.erklaerung, antwort, aufloesung, ergebnis: erg };
    }

    if (route.analyseTyp === 'umsatzveraenderung') {
      const erg = await this.analytik.umsatzveraenderung({ jahrVon: p.jahrVon ?? jahrMin, jahrBis: p.jahrBis ?? jahrMax, richtung: (p.richtung as 'steigerung' | 'rueckgang' | 'beide') ?? 'beide', waehrung: p.waehrung ?? 'EUR', limit: p.limit ?? 25 });
      const top = erg.zeilen[0];
      const antwort = top
        ? `Größte ${erg.parameter.richtung === 'rueckgang' ? 'Rückgänge' : erg.parameter.richtung === 'steigerung' ? 'Steigerungen' : 'Veränderungen'} von ${erg.parameter.jahrVon} zu ${erg.parameter.jahrBis}: ${top.kundenname ?? top.kundennummer} mit ${keur(top.deltaEur as number)} (${top.deltaProzent ?? '—'} %).`
        : 'Keine Kunden im gewählten Zeitraum.';
      return { analyseTyp: route.analyseTyp, erklaerung: route.erklaerung, antwort, aufloesung, ergebnis: erg };
    }

    if (route.analyseTyp === 'mengentrend') {
      const erg = await this.analytik.mengentrend({ jahrVon: p.jahrVon ?? jahrMin, jahrBis: p.jahrBis ?? jahrMax, dimension: p.dimension === 'produkt' ? 'produkt' : 'kunde', richtung: (p.richtung as 'steigerung' | 'rueckgang' | 'beide') ?? 'beide', waehrung: p.waehrung ?? 'EUR', limit: p.limit ?? 25 });
      const top = erg.zeilen[0];
      const antwort = top
        ? `Größte Mengenveränderung (je ${erg.parameter.dimension}) von ${erg.parameter.jahrVon} zu ${erg.parameter.jahrBis}: ${top.label ?? top.schluessel} mit ${(top.deltaMenge as number).toLocaleString('de-DE')} Stück (${top.deltaProzent ?? '—'} %).`
        : 'Keine Daten im gewählten Zeitraum.';
      return { analyseTyp: route.analyseTyp, erklaerung: route.erklaerung, antwort, aufloesung, ergebnis: erg };
    }

    // kundenzeitreihe
    const kunde = await this.findeKunde(p.kundenSuche);
    aufloesung.kunde = kunde ? `${kunde.name} (${kunde.dataAreaId}/${kunde.kundennummer})` : `„${p.kundenSuche ?? ''}" nicht gefunden`;
    if (!kunde) {
      return {
        analyseTyp: 'kundenzeitreihe',
        erklaerung: route.erklaerung,
        antwort: `Für „${p.kundenSuche ?? ''}" wurde kein Kunde im Stamm gefunden. Bitte den Kundennamen präzisieren.`,
        aufloesung,
        ergebnis: null,
      };
    }
    const erg = await this.analytik.kundenzeitreihe({ dataAreaId: kunde.dataAreaId, kundennummer: kunde.kundennummer, produktnummer: produkt?.produktnummer, waehrung: p.waehrung ?? 'EUR' });
    const letzte = erg.zeilen[erg.zeilen.length - 1];
    const antwort = erg.zeilen.length
      ? `${kunde.name}: ${erg.zeilen.length} Jahre Historie${produkt ? ` für ${produkt.produktname ?? produkt.produktnummer}` : ''}; zuletzt (${letzte.jahr}) ${keur(letzte.umsatz as number)} Umsatz bei ${(letzte.menge as number).toLocaleString('de-DE')} Stück.`
      : `Für ${kunde.name} liegen keine Positionen in der gewählten Währung vor.`;
    return { analyseTyp: 'kundenzeitreihe', erklaerung: route.erklaerung, antwort, aufloesung, ergebnis: erg };
  }
}
