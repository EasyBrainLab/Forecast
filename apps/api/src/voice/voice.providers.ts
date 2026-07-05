import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Provider-Abstraktion für Speech-to-Text und LLM-Extraktion.
 * Alle Aufrufe serverseitig; Keys nur per ENV. Mock-Provider ermöglichen den
 * geforderten E2E-Test des Diktat-Flows ohne externe Dienste.
 */

export const VOICE_SPRACHEN = ['de', 'en', 'es', 'pt', 'fr'] as const;

export interface SttErgebnis {
  text: string;
  sprache: string | null;
}

// ─────────── STT (Whisper via OpenAI-API oder Mock) ───────────

@Injectable()
export class SttService {
  private readonly logger = new Logger('SttService');

  /** 'openai' | 'mock' | 'aus' — auto: openai wenn Key vorhanden. */
  provider(): 'openai' | 'mock' | 'aus' {
    const konfiguriert = (process.env.STT_PROVIDER ?? '').toLowerCase();
    if (konfiguriert === 'mock') return 'mock';
    if (konfiguriert === 'openai' || process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY ? 'openai' : 'aus';
    return 'aus';
  }

  async transkribiere(audio: Buffer, mimeType: string, spracheHint?: string | null): Promise<SttErgebnis> {
    const provider = this.provider();
    if (provider === 'mock') {
      // Deterministischer Mock: Audio-Buffer wird als UTF-8-Transkript interpretiert (Testbarkeit).
      return { text: audio.toString('utf-8'), sprache: spracheHint ?? 'de' };
    }
    if (provider === 'aus') {
      throw new ServiceUnavailableException('Diktat ist nicht konfiguriert (OPENAI_API_KEY fehlt).');
    }
    // OpenAI Whisper API (multipart) — Node 22: fetch/FormData/Blob global.
    const form = new FormData();
    const ext = mimeType.includes('mp4') || mimeType.includes('m4a') ? 'm4a' : mimeType.includes('mpeg') ? 'mp3' : mimeType.includes('ogg') ? 'ogg' : mimeType.includes('wav') ? 'wav' : 'webm';
    form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), `diktat.${ext}`);
    form.append('model', process.env.STT_MODEL ?? 'whisper-1');
    form.append('response_format', 'verbose_json');
    if (spracheHint && (VOICE_SPRACHEN as readonly string[]).includes(spracheHint)) form.append('language', spracheHint);
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      this.logger.warn(`STT fehlgeschlagen (${res.status}): ${detail.slice(0, 300)}`);
      throw new ServiceUnavailableException(`Spracherkennung fehlgeschlagen (${res.status}).`);
    }
    const data = (await res.json()) as { text?: string; language?: string };
    return { text: (data.text ?? '').trim(), sprache: data.language ?? spracheHint ?? null };
  }
}

// ─────────── LLM-Extraktion (Anthropic Claude oder Mock) ───────────

/** Eine vom LLM extrahierte Zahl mit wörtlichem Transkript-Ausschnitt (Zahlen-Guardrail). */
export interface GuardrailZahl {
  pfad: string; // z. B. "kopf.forecastFolgemonatEur" oder "eintraege[2].menge"
  wert: number;
  kontext: string; // wörtlicher Ausschnitt aus dem Transkript
}

export interface ExtraktionsEintrag {
  abschnitt: string;
  typ: string | null;
  beschreibung: string;
  ergebnis: string | null;
  datum: string | null;
  kundeName: string | null;
  wettbewerberName: string | null;
  landIso: string | null;
  stadt: string | null;
  menge: number | null;
  kostenEur: number | null;
  erwarteterUmsatzEur: number | null;
  wahrscheinlichkeit: number | null;
  preisInfo: string | null;
}

export interface Extraktion {
  kopf: {
    forecastFolgemonatEur: number | null;
    forecastQuartalEur: number | null;
    wettbewerbKeineAenderung: boolean | null;
    marktAllgemein: string | null;
    personal: string | null;
    sonstiges: string | null;
  };
  eintraege: ExtraktionsEintrag[];
  zahlen: GuardrailZahl[];
}

const NULLABLE_NUM = { type: ['number', 'null'] } as const;
const NULLABLE_STR = { type: ['string', 'null'] } as const;

/** JSON-Schema für structured outputs (additionalProperties:false + vollständige required-Listen). */
const EXTRAKTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kopf', 'eintraege', 'zahlen'],
  properties: {
    kopf: {
      type: 'object',
      additionalProperties: false,
      required: ['forecastFolgemonatEur', 'forecastQuartalEur', 'wettbewerbKeineAenderung', 'marktAllgemein', 'personal', 'sonstiges'],
      properties: {
        forecastFolgemonatEur: NULLABLE_NUM,
        forecastQuartalEur: NULLABLE_NUM,
        wettbewerbKeineAenderung: { type: ['boolean', 'null'] },
        marktAllgemein: NULLABLE_STR,
        personal: NULLABLE_STR,
        sonstiges: NULLABLE_STR,
      },
    },
    eintraege: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['abschnitt', 'typ', 'beschreibung', 'ergebnis', 'datum', 'kundeName', 'wettbewerberName', 'landIso', 'stadt', 'menge', 'kostenEur', 'erwarteterUmsatzEur', 'wahrscheinlichkeit', 'preisInfo'],
        properties: {
          abschnitt: { type: 'string', enum: ['KRITISCH', 'IMPLANTATION', 'AKTIVITAET_NEUKUNDE', 'AKTIVITAET_BESTAND', 'MARKETING', 'PROJEKT', 'NAECHSTE_AKTIVITAET', 'WETTBEWERB'] },
          typ: NULLABLE_STR,
          beschreibung: { type: 'string' },
          ergebnis: NULLABLE_STR,
          datum: NULLABLE_STR,
          kundeName: NULLABLE_STR,
          wettbewerberName: NULLABLE_STR,
          landIso: NULLABLE_STR,
          stadt: NULLABLE_STR,
          menge: NULLABLE_NUM,
          kostenEur: NULLABLE_NUM,
          erwarteterUmsatzEur: NULLABLE_NUM,
          wahrscheinlichkeit: NULLABLE_NUM,
          preisInfo: NULLABLE_STR,
        },
      },
    },
    zahlen: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['pfad', 'wert', 'kontext'],
        properties: { pfad: { type: 'string' }, wert: { type: 'number' }, kontext: { type: 'string' } },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `Du extrahierst aus dem frei diktierten Monatsbericht eines Vertriebsmitarbeiters (Brachytherapie: LDR-Seeds/Implantate, Ophthalmo/Ruthenium, HDR/Afterloader) strukturierte Daten für die Berichtsmaske.

Regeln:
- Das Transkript kann Deutsch, Englisch, Spanisch, Portugiesisch oder Französisch sein. Freitexte (beschreibung, ergebnis, marktAllgemein, ...) bleiben in der Originalsprache des Diktats.
- Ordne Aussagen den Abschnitten zu: KRITISCH (Typen: TENDER, KUNDENVERLUST, NEUKUNDE, PRODUKTPROBLEM, LIEFERPROBLEM, SONSTIGES), IMPLANTATION (Anzahl Implantationen je Standort -> menge), AKTIVITAET_NEUKUNDE / AKTIVITAET_BESTAND (Typen: BESUCH, TRAINING, MEETING, SUPPORT), MARKETING (Kongresse/Events, kostenEur optional), PROJEKT (Projektliste: erwarteterUmsatzEur, wahrscheinlichkeit 0-100, landIso, stadt), NAECHSTE_AKTIVITAET, WETTBEWERB (wettbewerberName Pflicht, preisInfo falls genannt).
- kopf.forecastFolgemonatEur / kopf.forecastQuartalEur: nur setzen, wenn der Sprecher sie ausdrücklich nennt. Beträge immer in vollen EUR (z. B. "250 tausend" -> 250000, "1,2 Millionen" -> 1200000).
- kopf.wettbewerbKeineAenderung: true nur bei ausdrücklicher Aussage wie "keine Veränderung beim Wettbewerb".
- kundeName/wettbewerberName: wörtlich wie diktiert (das Matching gegen Stammdaten passiert außerhalb).
- datum: ISO JJJJ-MM-TT, nur wenn eindeutig ableitbar.
- ZAHLEN-GUARDRAIL (kritisch): Erfasse in "zahlen" JEDE extrahierte Zahl (Beträge, Stückzahlen, Prozente, auch Datumsangaben, wenn diktiert) mit "pfad" (z. B. "kopf.forecastFolgemonatEur", "eintraege[0].menge"), "wert" und "kontext" = wörtlicher kurzer Ausschnitt aus dem Transkript, in dem die Zahl vorkommt. Spracherkennung verwechselt Zahlen systematisch — der Nutzer bestätigt jede Zahl einzeln anhand des Kontexts.
- Erfinde nichts. Was nicht diktiert wurde, bleibt null bzw. wird nicht als Eintrag angelegt.`;

@Injectable()
export class LlmExtraktionService {
  private readonly logger = new Logger('LlmExtraktion');

  provider(): 'anthropic' | 'mock' | 'aus' {
    const konfiguriert = (process.env.LLM_PROVIDER ?? '').toLowerCase();
    if (konfiguriert === 'mock') return 'mock';
    if (konfiguriert === 'anthropic' || process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'aus';
    return 'aus';
  }

  modell(): string {
    return process.env.LLM_MODEL ?? 'claude-opus-4-8';
  }

  async extrahiere(transkript: string): Promise<Extraktion> {
    const provider = this.provider();
    if (provider === 'mock') return this.mockExtraktion(transkript);
    if (provider === 'aus') throw new ServiceUnavailableException('KI-Extraktion ist nicht konfiguriert (ANTHROPIC_API_KEY fehlt).');

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    try {
      const response = await client.messages.create({
        model: this.modell(),
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        system: SYSTEM_PROMPT,
        output_config: { format: { type: 'json_schema', schema: EXTRAKTION_SCHEMA as unknown as Record<string, unknown> } },
        messages: [{ role: 'user', content: `Transkript des Diktats:\n\n${transkript}` }],
      } as Anthropic.MessageCreateParamsNonStreaming);
      if (response.stop_reason === 'refusal') {
        throw new ServiceUnavailableException('Die KI-Extraktion wurde abgelehnt. Bitte Bericht manuell erfassen.');
      }
      if (response.stop_reason === 'max_tokens') {
        throw new ServiceUnavailableException('Das Diktat ist zu lang für eine Extraktion am Stück. Bitte kürzer diktieren.');
      }
      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
      if (!textBlock) throw new ServiceUnavailableException('Leere KI-Antwort.');
      return this.sanitize(JSON.parse(textBlock.text) as Extraktion);
    } catch (e) {
      if (e instanceof ServiceUnavailableException) throw e;
      if (e instanceof Anthropic.APIError) {
        this.logger.warn(`Anthropic-Fehler ${e.status}: ${e.message}`);
        throw new ServiceUnavailableException(`KI-Extraktion fehlgeschlagen (${e.status ?? 'Netzwerk'}).`);
      }
      this.logger.warn(`Extraktion fehlgeschlagen: ${(e as Error).message}`);
      throw new ServiceUnavailableException('KI-Extraktion fehlgeschlagen.');
    }
  }

  /** Defensive Normalisierung des LLM-Outputs (Schema garantiert Form, nicht Sinnhaftigkeit). */
  private sanitize(e: Extraktion): Extraktion {
    return {
      kopf: {
        forecastFolgemonatEur: numOrNull(e.kopf?.forecastFolgemonatEur),
        forecastQuartalEur: numOrNull(e.kopf?.forecastQuartalEur),
        wettbewerbKeineAenderung: typeof e.kopf?.wettbewerbKeineAenderung === 'boolean' ? e.kopf.wettbewerbKeineAenderung : null,
        marktAllgemein: strOrNull(e.kopf?.marktAllgemein),
        personal: strOrNull(e.kopf?.personal),
        sonstiges: strOrNull(e.kopf?.sonstiges),
      },
      eintraege: (Array.isArray(e.eintraege) ? e.eintraege : []).slice(0, 50).map((it) => ({
        abschnitt: String(it.abschnitt ?? 'SONSTIGES'),
        typ: strOrNull(it.typ),
        beschreibung: String(it.beschreibung ?? '').slice(0, 4000),
        ergebnis: strOrNull(it.ergebnis),
        datum: strOrNull(it.datum),
        kundeName: strOrNull(it.kundeName),
        wettbewerberName: strOrNull(it.wettbewerberName),
        landIso: strOrNull(it.landIso),
        stadt: strOrNull(it.stadt),
        menge: numOrNull(it.menge),
        kostenEur: numOrNull(it.kostenEur),
        erwarteterUmsatzEur: numOrNull(it.erwarteterUmsatzEur),
        wahrscheinlichkeit: numOrNull(it.wahrscheinlichkeit),
        preisInfo: strOrNull(it.preisInfo),
      })),
      zahlen: (Array.isArray(e.zahlen) ? e.zahlen : []).slice(0, 100).map((z) => ({
        pfad: String(z.pfad ?? ''),
        wert: Number(z.wert ?? 0),
        kontext: String(z.kontext ?? '').slice(0, 500),
      })),
    };
  }

  /** Deterministischer Mock für den E2E-Test: erkennt einfache deutsche Muster. */
  private mockExtraktion(transkript: string): Extraktion {
    const zahlen: GuardrailZahl[] = [];
    const kopf: Extraktion['kopf'] = { forecastFolgemonatEur: null, forecastQuartalEur: null, wettbewerbKeineAenderung: null, marktAllgemein: null, personal: null, sonstiges: null };
    const eintraege: ExtraktionsEintrag[] = [];
    const fcMatch = /forecast[^0-9]*?(\d[\d.]*)\s*(tausend|euro)?/i.exec(transkript);
    if (fcMatch) {
      const basis = Number(fcMatch[1].replace(/\./g, ''));
      const wert = /tausend/i.test(fcMatch[2] ?? '') ? basis * 1000 : basis;
      kopf.forecastFolgemonatEur = wert;
      zahlen.push({ pfad: 'kopf.forecastFolgemonatEur', wert, kontext: fcMatch[0] });
    }
    const implMatch = /(\d+)\s*implantation/i.exec(transkript);
    if (implMatch) {
      const menge = Number(implMatch[1]);
      eintraege.push({ abschnitt: 'IMPLANTATION', typ: null, beschreibung: 'Implantationen laut Diktat', ergebnis: null, datum: null, kundeName: /bei\s+([A-Za-zÄÖÜäöüß .-]+?)(?:[,.]|$)/.exec(transkript)?.[1]?.trim() ?? null, wettbewerberName: null, landIso: null, stadt: null, menge, kostenEur: null, erwarteterUmsatzEur: null, wahrscheinlichkeit: null, preisInfo: null });
      zahlen.push({ pfad: 'eintraege[0].menge', wert: menge, kontext: implMatch[0] });
    }
    if (/keine veränderung.*wettbewerb|wettbewerb.*keine veränderung/i.test(transkript)) kopf.wettbewerbKeineAenderung = true;
    return { kopf, eintraege, zahlen };
  }
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return v == null || Number.isNaN(n) ? null : n;
}
function strOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, 4000) : null;
}
