import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { KiConfigService } from '../ki/ki-config.service';

/**
 * KI-Analyse von Ausschreibungs-Dokumenten. PDFs gehen als document-Block direkt an Claude
 * (visuelles Verständnis von Tabellen/Formularen); Text als Text. Alle Aufrufe serverseitig.
 * Mock-Provider (LLM_PROVIDER=mock) für den E2E-Test.
 */

export interface AnalyseZahl {
  pfad: string;
  wert: number | string; // Beträge/Mengen als Zahl; Fristen als ISO-Datum-String
  kontext: string; // wörtliches Zitat aus dem Dokument
}

export interface AnalyseFrage {
  frage: string; // in der Ausschreibung geforderte Angabe/Frage an den Bieter
  antwortVorschlag: string; // KI-Entwurf (leer, wenn nicht ableitbar)
  quelle: string; // Fundstelle/Zitat
}

export interface AnalyseLos {
  bezeichnung: string;
  menge: number | null;
  volumenEur: number | null;
}

export interface TenderAnalyse {
  referenznummer: string | null;
  auftraggeber: string | null; // Vergabestelle/Krankenhaus
  stadt: string | null;
  landIso: string | null;
  veroeffentlichtAm: string | null; // ISO JJJJ-MM-TT
  abgabefrist: string | null; // ISO JJJJ-MM-TT
  sprache: string | null;
  zusammenfassung: string;
  lose: AnalyseLos[];
  nachweise: string[]; // geforderte Unterlagen/Nachweise (Checkliste)
  fragen: AnalyseFrage[];
  zahlen: AnalyseZahl[];
}

const NULLSTR = { type: ['string', 'null'] } as const;
const NULLNUM = { type: ['number', 'null'] } as const;

const ANALYSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['referenznummer', 'auftraggeber', 'stadt', 'landIso', 'veroeffentlichtAm', 'abgabefrist', 'sprache', 'zusammenfassung', 'lose', 'nachweise', 'fragen', 'zahlen'],
  properties: {
    referenznummer: NULLSTR,
    auftraggeber: NULLSTR,
    stadt: NULLSTR,
    landIso: NULLSTR,
    veroeffentlichtAm: NULLSTR,
    abgabefrist: NULLSTR,
    sprache: NULLSTR,
    zusammenfassung: { type: 'string' },
    lose: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['bezeichnung', 'menge', 'volumenEur'],
        properties: { bezeichnung: { type: 'string' }, menge: NULLNUM, volumenEur: NULLNUM },
      },
    },
    nachweise: { type: 'array', items: { type: 'string' } },
    fragen: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['frage', 'antwortVorschlag', 'quelle'],
        properties: { frage: { type: 'string' }, antwortVorschlag: { type: 'string' }, quelle: { type: 'string' } },
      },
    },
    zahlen: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['pfad', 'wert', 'kontext'],
        properties: { pfad: { type: 'string' }, wert: { type: ['number', 'string'] }, kontext: { type: 'string' } },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `Du analysierst eine öffentliche Ausschreibung (Tender) für einen Hersteller von Brachytherapie-Produkten (LDR-Seeds/Implantate, Ru-106-Ophthalmo-Applikatoren, HDR-Afterloader) und extrahierst die für die Angebotsabgabe nötigen Daten.

Regeln:
- Das Dokument kann Deutsch, Englisch, Spanisch, Portugiesisch, Französisch o. a. sein. "zusammenfassung", "nachweise", "fragen" bleiben in der Dokumentsprache.
- referenznummer: Vergabe-/Ausschreibungsnummer wörtlich. auftraggeber: Vergabestelle/Klinik. landIso: ISO-2 (ES, PT, DE, ...).
- Fristen als ISO JJJJ-MM-TT. abgabefrist = Angebots-/Einreichungsfrist (die wichtigste Frist!). Nur setzen, wenn im Dokument eindeutig.
- lose: alle Lose mit Bezeichnung, Menge (Stück) und geschätztem Wert/Volumen in EUR, sofern angegeben.
- nachweise: Checkliste der geforderten Unterlagen/Nachweise/Zertifikate (z. B. CE, ISO 13485, Referenzen, Eigenerklärungen) — je ein kurzer Punkt.
- fragen: JEDE vom Bieter geforderte Angabe/Antwort (Formularfelder, Leistungsfragen, technische Anforderungen mit Antwortpflicht). "antwortVorschlag": nur ausfüllen, was sich seriös aus Branchen-/Dokumentkontext ableiten lässt (Produkteigenschaften der Brachytherapie-Produkte, Standardangaben) — sonst leer lassen. "quelle": kurzes Zitat/Abschnittsverweis.
- ZAHLEN-GUARDRAIL: Erfasse in "zahlen" JEDE kritische Zahl/Frist (abgabefrist, veroeffentlichtAm, Mengen, Volumina) mit "pfad" (z. B. "abgabefrist", "lose[0].menge"), "wert" und "kontext" = wörtliches kurzes Zitat aus dem Dokument. Der Nutzer bestätigt jede einzeln.
- Erfinde nichts. Unbekanntes bleibt null bzw. leer.`;

@Injectable()
export class TenderAnalyseProvider {
  private readonly logger = new Logger('TenderAnalyse');

  constructor(private readonly config: KiConfigService) {}

  async provider(): Promise<'anthropic' | 'mock' | 'aus'> {
    if ((process.env.LLM_PROVIDER ?? '').toLowerCase() === 'mock') return 'mock';
    return (await this.config.anthropicKey()) ? 'anthropic' : 'aus';
  }

  async analysiere(inhalt: Buffer, mimeType: string): Promise<TenderAnalyse> {
    const provider = await this.provider();
    if (provider === 'mock') return this.mockAnalyse(inhalt.toString('utf-8'));
    if (provider === 'aus') throw new ServiceUnavailableException('KI-Analyse ist nicht konfiguriert (Anthropic-Key fehlt — Admin → KI & Ausschreibungen).');

    const client = new Anthropic({ apiKey: (await this.config.anthropicKey())! });
    const istPdf = mimeType.includes('pdf');
    const userContent: Anthropic.ContentBlockParam[] = istPdf
      ? [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: inhalt.toString('base64') } },
          { type: 'text', text: 'Analysiere diese Ausschreibung gemäß den Regeln.' },
        ]
      : [{ type: 'text', text: `Ausschreibungstext:\n\n${inhalt.toString('utf-8').slice(0, 400_000)}` }];

    try {
      const response = await client.messages.create({
        model: await this.config.llmModell(),
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        system: SYSTEM_PROMPT,
        output_config: { format: { type: 'json_schema', schema: ANALYSE_SCHEMA as unknown as Record<string, unknown> } },
        messages: [{ role: 'user', content: userContent }],
      } as Anthropic.MessageCreateParamsNonStreaming);
      if (response.stop_reason === 'refusal') throw new ServiceUnavailableException('Die KI-Analyse wurde abgelehnt.');
      if (response.stop_reason === 'max_tokens') throw new ServiceUnavailableException('Dokument zu umfangreich für eine Analyse am Stück.');
      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
      if (!textBlock) throw new ServiceUnavailableException('Leere KI-Antwort.');
      return this.sanitize(JSON.parse(textBlock.text) as TenderAnalyse);
    } catch (e) {
      if (e instanceof ServiceUnavailableException) throw e;
      if (e instanceof Anthropic.APIError) {
        this.logger.warn(`Anthropic-Fehler ${e.status}: ${e.message}`);
        throw new ServiceUnavailableException(`KI-Analyse fehlgeschlagen (${e.status ?? 'Netzwerk'}).`);
      }
      this.logger.warn(`Analyse fehlgeschlagen: ${(e as Error).message}`);
      throw new ServiceUnavailableException('KI-Analyse fehlgeschlagen.');
    }
  }

  private sanitize(a: TenderAnalyse): TenderAnalyse {
    const s = (v: unknown, max = 500): string | null => {
      if (v == null) return null;
      const t = String(v).trim();
      return t ? t.slice(0, max) : null;
    };
    const n = (v: unknown): number | null => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
    return {
      referenznummer: s(a.referenznummer, 120),
      auftraggeber: s(a.auftraggeber, 200),
      stadt: s(a.stadt, 120),
      landIso: s(a.landIso, 8)?.toUpperCase() ?? null,
      veroeffentlichtAm: s(a.veroeffentlichtAm, 10),
      abgabefrist: s(a.abgabefrist, 10),
      sprache: s(a.sprache, 8),
      zusammenfassung: String(a.zusammenfassung ?? '').slice(0, 4000),
      lose: (Array.isArray(a.lose) ? a.lose : []).slice(0, 50).map((l) => ({ bezeichnung: String(l.bezeichnung ?? '').slice(0, 200), menge: n(l.menge), volumenEur: n(l.volumenEur) })),
      nachweise: (Array.isArray(a.nachweise) ? a.nachweise : []).slice(0, 60).map((x) => String(x).slice(0, 300)),
      fragen: (Array.isArray(a.fragen) ? a.fragen : []).slice(0, 80).map((f) => ({ frage: String(f.frage ?? '').slice(0, 1000), antwortVorschlag: String(f.antwortVorschlag ?? '').slice(0, 2000), quelle: String(f.quelle ?? '').slice(0, 300) })),
      zahlen: (Array.isArray(a.zahlen) ? a.zahlen : []).slice(0, 100).map((z) => ({ pfad: String(z.pfad ?? ''), wert: typeof z.wert === 'number' ? z.wert : String(z.wert ?? ''), kontext: String(z.kontext ?? '').slice(0, 500) })),
    };
  }

  /** Deterministischer Mock: einfache Muster für den E2E-Test. */
  private mockAnalyse(text: string): TenderAnalyse {
    const zahlen: AnalyseZahl[] = [];
    const ref = /Referenz(?:nummer)?[:\s]+([A-Z0-9-/]+)/i.exec(text)?.[1] ?? null;
    const fristMatch = /Abgabefrist[:\s]+(\d{4}-\d{2}-\d{2})/i.exec(text);
    const abgabefrist = fristMatch?.[1] ?? null;
    if (fristMatch) zahlen.push({ pfad: 'abgabefrist', wert: fristMatch[1], kontext: fristMatch[0] });
    const losMatch = /Los\s*1[:\s]+([^,\n]+),\s*(\d+)\s*St(?:ü|u)ck,\s*([\d.]+)\s*EUR/i.exec(text);
    const lose: AnalyseLos[] = [];
    if (losMatch) {
      lose.push({ bezeichnung: losMatch[1].trim(), menge: Number(losMatch[2]), volumenEur: Number(losMatch[3].replace(/\./g, '')) });
      zahlen.push({ pfad: 'lose[0].menge', wert: Number(losMatch[2]), kontext: losMatch[0] });
      zahlen.push({ pfad: 'lose[0].volumenEur', wert: Number(losMatch[3].replace(/\./g, '')), kontext: losMatch[0] });
    }
    return {
      referenznummer: ref,
      auftraggeber: /Auftraggeber[:\s]+([^\n]+)/i.exec(text)?.[1]?.trim() ?? null,
      stadt: null,
      landIso: /Land[:\s]+([A-Z]{2})/.exec(text)?.[1] ?? null,
      veroeffentlichtAm: null,
      abgabefrist,
      sprache: 'de',
      zusammenfassung: 'Mock-Analyse für den E2E-Test.',
      lose,
      nachweise: /CE-Kennzeichnung/i.test(text) ? ['CE-Kennzeichnung', 'ISO 13485'] : [],
      fragen: [{ frage: 'Lieferzeit ab Bestellung?', antwortVorschlag: '', quelle: 'Mock §1' }],
      zahlen,
    };
  }
}
