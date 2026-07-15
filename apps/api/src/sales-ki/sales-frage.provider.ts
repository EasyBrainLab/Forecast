import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { KiConfigService } from '../ki/ki-config.service';

export type AnalyseTyp = 'preisstabilitaet' | 'umsatzveraenderung' | 'kundenzeitreihe' | 'mengentrend' | 'unbekannt';

export interface FrageParameter {
  jahre: number | null;
  toleranzProzent: number | null;
  jahrVon: number | null;
  jahrBis: number | null;
  richtung: string | null; // steigerung | rueckgang | beide
  dimension: string | null; // kunde | produkt
  waehrung: string | null;
  kundenSuche: string | null; // Kundenname/-nummer aus der Frage
  produktSuche: string | null; // Produktname/-nummer aus der Frage
  limit: number | null;
}

export interface FrageRoute {
  analyseTyp: AnalyseTyp;
  parameter: FrageParameter;
  erklaerung: string;
}

const NULLNUM = { type: ['number', 'null'] } as const;
const NULLSTR = { type: ['string', 'null'] } as const;

const ROUTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['analyseTyp', 'parameter', 'erklaerung'],
  properties: {
    analyseTyp: { type: 'string', enum: ['preisstabilitaet', 'umsatzveraenderung', 'kundenzeitreihe', 'mengentrend', 'unbekannt'] },
    parameter: {
      type: 'object',
      additionalProperties: false,
      required: ['jahre', 'toleranzProzent', 'jahrVon', 'jahrBis', 'richtung', 'dimension', 'waehrung', 'kundenSuche', 'produktSuche', 'limit'],
      properties: {
        jahre: NULLNUM,
        toleranzProzent: NULLNUM,
        jahrVon: NULLNUM,
        jahrBis: NULLNUM,
        richtung: NULLSTR,
        dimension: NULLSTR,
        waehrung: NULLSTR,
        kundenSuche: NULLSTR,
        produktSuche: NULLSTR,
        limit: NULLNUM,
      },
    },
    erklaerung: { type: 'string' },
  },
} as const;

function systemPrompt(jahrMin: number, jahrMax: number): string {
  return `Du ordnest eine natürlichsprachige Frage zu Vertriebs-/Rechnungsdaten (Brachytherapie) genau EINEM Auswertungstyp zu und extrahierst die Parameter. Antworte NUR über das JSON-Schema. Die Daten reichen von ${jahrMin} bis ${jahrMax}.

Auswertungstypen:
- "preisstabilitaet": Kunden, die für ein Produkt über ≥ N Jahre denselben Preis zahlen. Parameter: jahre (Default 3), toleranzProzent (Default 0), produktSuche (optional).
- "umsatzveraenderung": größte Umsatzsteigerung/-rückgang je Kunde zwischen zwei Jahren. Parameter: jahrVon, jahrBis, richtung ("steigerung"|"rueckgang"|"beide").
- "kundenzeitreihe": Umsatz/Menge/Preis EINES bestimmten Kunden über die Jahre. Parameter: kundenSuche (Pflicht — Name/Nummer des Kunden aus der Frage), produktSuche (optional).
- "mengentrend": größte Mengenveränderung zwischen zwei Jahren, je Kunde oder Produkt. Parameter: jahrVon, jahrBis, dimension ("kunde"|"produkt"), richtung.
- "unbekannt": wenn die Frage sich nicht auf diese Umsatz-/Preis-/Mengendaten bezieht.

Regeln:
- Fülle nur die für den gewählten Typ relevanten Parameter, alle anderen null.
- Jahre: nenne die Frage konkrete Jahre, übernimm sie; sonst jahrVon=${jahrMin}, jahrBis=${jahrMax} bei Vergleichen.
- richtung: "gesunken/Rückgang/verloren" → "rueckgang"; "gestiegen/Wachstum/Zuwachs" → "steigerung"; sonst "beide".
- waehrung: nur setzen, wenn die Frage eine Währung nennt (EUR/GBP/…), sonst null (Default EUR).
- kundenSuche/produktSuche: der wörtliche Such-Text aus der Frage (Kunden- bzw. Produktname/-nummer), sonst null.
- erklaerung: ein kurzer Satz, wie du die Frage interpretiert hast.
- Erfinde keine Parameter. Im Zweifel "unbekannt".`;
}

/** Übersetzt eine Freitextfrage in einen sicheren Auswertungstyp + Parameter (kein freies SQL). */
@Injectable()
export class SalesFrageProvider {
  private readonly logger = new Logger('SalesFrage');

  constructor(private readonly config: KiConfigService) {}

  async provider(): Promise<'anthropic' | 'mock' | 'aus'> {
    if ((process.env.LLM_PROVIDER ?? '').toLowerCase() === 'mock') return 'mock';
    return (await this.config.anthropicKey()) ? 'anthropic' : 'aus';
  }

  async route(frage: string, jahrMin: number, jahrMax: number): Promise<FrageRoute> {
    const provider = await this.provider();
    if (provider === 'mock') return this.mockRoute(frage, jahrMin, jahrMax);
    if (provider === 'aus') throw new ServiceUnavailableException('KI ist nicht konfiguriert (Anthropic-Key fehlt — Admin → KI & Ausschreibungen).');

    const client = new Anthropic({ apiKey: (await this.config.anthropicKey())! });
    try {
      const response = await client.messages.create({
        model: await this.config.llmModell(),
        max_tokens: 2000,
        thinking: { type: 'adaptive' },
        system: systemPrompt(jahrMin, jahrMax),
        output_config: { format: { type: 'json_schema', schema: ROUTE_SCHEMA as unknown as Record<string, unknown> } },
        messages: [{ role: 'user', content: `Frage: ${frage}` }],
      } as Anthropic.MessageCreateParamsNonStreaming);
      if (response.stop_reason === 'refusal') throw new ServiceUnavailableException('Die KI-Antwort wurde abgelehnt.');
      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
      if (!textBlock) throw new ServiceUnavailableException('Leere KI-Antwort.');
      return this.sanitize(JSON.parse(textBlock.text) as FrageRoute);
    } catch (e) {
      if (e instanceof ServiceUnavailableException) throw e;
      if (e instanceof Anthropic.APIError) {
        this.logger.warn(`Anthropic-Fehler ${e.status}: ${e.message}`);
        throw new ServiceUnavailableException(`KI-Anfrage fehlgeschlagen (${e.status ?? 'Netzwerk'}).`);
      }
      this.logger.warn(`Route fehlgeschlagen: ${(e as Error).message}`);
      throw new ServiceUnavailableException('KI-Anfrage fehlgeschlagen.');
    }
  }

  private sanitize(r: FrageRoute): FrageRoute {
    const typen: AnalyseTyp[] = ['preisstabilitaet', 'umsatzveraenderung', 'kundenzeitreihe', 'mengentrend', 'unbekannt'];
    const analyseTyp = typen.includes(r.analyseTyp) ? r.analyseTyp : 'unbekannt';
    const p = r.parameter ?? ({} as FrageParameter);
    const n = (v: unknown): number | null => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
    const s = (v: unknown, max = 200): string | null => (v == null ? null : String(v).trim().slice(0, max) || null);
    return {
      analyseTyp,
      parameter: {
        jahre: n(p.jahre),
        toleranzProzent: n(p.toleranzProzent),
        jahrVon: n(p.jahrVon),
        jahrBis: n(p.jahrBis),
        richtung: s(p.richtung, 16),
        dimension: s(p.dimension, 16),
        waehrung: s(p.waehrung, 8)?.toUpperCase() ?? null,
        kundenSuche: s(p.kundenSuche),
        produktSuche: s(p.produktSuche),
        limit: n(p.limit),
      },
      erklaerung: String(r.erklaerung ?? '').slice(0, 500),
    };
  }

  /** Deterministischer Mock (LLM_PROVIDER=mock) für den E2E-Test: Schlüsselwort-Routing. */
  private mockRoute(frage: string, jahrMin: number, jahrMax: number): FrageRoute {
    const t = frage.toLowerCase();
    const jahre = Number(/(\d+)\s*jahr/.exec(t)?.[1]) || null;
    const jahreImText = [...frage.matchAll(/\b(20\d\d)\b/g)].map((m) => Number(m[1]));
    const jahrVon = jahreImText[0] ?? jahrMin;
    const jahrBis = jahreImText[1] ?? jahrMax;
    const leer: FrageParameter = { jahre: null, toleranzProzent: null, jahrVon: null, jahrBis: null, richtung: null, dimension: null, waehrung: null, kundenSuche: null, produktSuche: null, limit: null };

    if (/preis/.test(t) && /(gleich|selb|stabil|same|konstant|unver)/.test(t)) {
      return { analyseTyp: 'preisstabilitaet', parameter: { ...leer, jahre: jahre ?? 3, toleranzProzent: 0 }, erklaerung: 'Mock: Preisstabilität.' };
    }
    if (/(menge|stück|stuck|st\.)/.test(t)) {
      return { analyseTyp: 'mengentrend', parameter: { ...leer, jahrVon, jahrBis, dimension: /produkt/.test(t) ? 'produkt' : 'kunde', richtung: 'beide' }, erklaerung: 'Mock: Mengentrend.' };
    }
    if (/entwicklung|zeitreihe|verlauf/.test(t) && /kunde/.test(t)) {
      // Ein Wort nach "Kunde(n)" als Suchbegriff (der echte Router extrahiert den Namen präziser).
      const kundenSuche = /kunde[n]?\s+([a-z0-9äöüß.&-]{2,})/i.exec(frage)?.[1]?.trim() ?? null;
      return { analyseTyp: 'kundenzeitreihe', parameter: { ...leer, kundenSuche }, erklaerung: 'Mock: Kundenzeitreihe.' };
    }
    if (/umsatz|ruckgang|rückgang|gesunken|steigerung|gestiegen|wachstum|zuwachs/.test(t)) {
      const richtung = /ruckgang|rückgang|gesunken|verloren/.test(t) ? 'rueckgang' : /steigerung|gestiegen|wachstum|zuwachs/.test(t) ? 'steigerung' : 'beide';
      return { analyseTyp: 'umsatzveraenderung', parameter: { ...leer, jahrVon, jahrBis, richtung }, erklaerung: 'Mock: Umsatzveränderung.' };
    }
    return { analyseTyp: 'unbekannt', parameter: leer, erklaerung: 'Mock: keine Zuordnung.' };
  }
}
