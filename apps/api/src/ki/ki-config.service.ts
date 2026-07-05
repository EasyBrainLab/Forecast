import { Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Zentrale KI-Konfiguration: Werte aus der Einstellung-Tabelle (Admin-UI) haben Vorrang,
 * ENV bleibt Fallback. API-Keys liegen NIE im Klartext in der DB — AES-256-GCM mit dem
 * ENCRYPTION_KEY aus der ENV (fail-fast validiert, >= 32 Byte base64). Keys sind write-only:
 * Leseendpunkte verraten nur, OB ein Key gesetzt ist.
 */

export const KI_KEYS = {
  LLM_MODEL: 'KI_LLM_MODEL',
  STT_MODEL: 'KI_STT_MODEL',
  ANTHROPIC_KEY_ENC: 'KI_ANTHROPIC_API_KEY_ENC',
  OPENAI_KEY_ENC: 'KI_OPENAI_API_KEY_ENC',
  FIRMENPROFIL: 'KI_FIRMENPROFIL', // Bieter-Stammdaten für den Tender-Antwortentwurf
} as const;

export const LLM_MODELLE = ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'] as const;
export const DEFAULT_LLM_MODEL = 'claude-opus-4-8';
export const DEFAULT_FIRMENPROFIL = `Eckert & Ziegler BEBIG GmbH
Robert-Rössle-Str. 10, 13125 Berlin, Deutschland
[Ansprechpartner, Telefon, E-Mail durch die Administration pflegen: Admin → KI & Ausschreibungen]`;

@Injectable()
export class KiConfigService {
  private readonly logger = new Logger('KiConfig');

  constructor(private readonly prisma: PrismaService) {}

  // ─────────── Crypto (AES-256-GCM, Format v1:iv:tag:cipher, alles base64) ───────────

  private schluessel(): Buffer {
    return Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'base64').subarray(0, 32);
  }

  verschluessele(klartext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.schluessel(), iv);
    const enc = Buffer.concat([cipher.update(klartext, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
  }

  entschluessele(wert: string): string | null {
    try {
      const [version, ivB64, tagB64, dataB64] = wert.split(':');
      if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) return null;
      const decipher = createDecipheriv('aes-256-gcm', this.schluessel(), Buffer.from(ivB64, 'base64'));
      decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
    } catch (e) {
      this.logger.warn(`Key-Entschlüsselung fehlgeschlagen (ENCRYPTION_KEY geändert?): ${(e as Error).message}`);
      return null;
    }
  }

  // ─────────── Auflösung: DB-Einstellung -> ENV-Fallback ───────────

  private async einstellung(key: string): Promise<string | null> {
    return (await this.prisma.einstellung.findUnique({ where: { key } }))?.value ?? null;
  }

  private async geheim(key: string, envName: string): Promise<string | null> {
    const enc = await this.einstellung(key);
    if (enc) {
      const klar = this.entschluessele(enc);
      if (klar) return klar;
    }
    return process.env[envName] || null;
  }

  async anthropicKey(): Promise<string | null> {
    return this.geheim(KI_KEYS.ANTHROPIC_KEY_ENC, 'ANTHROPIC_API_KEY');
  }

  async openaiKey(): Promise<string | null> {
    return this.geheim(KI_KEYS.OPENAI_KEY_ENC, 'OPENAI_API_KEY');
  }

  async llmModell(): Promise<string> {
    return (await this.einstellung(KI_KEYS.LLM_MODEL)) || process.env.LLM_MODEL || DEFAULT_LLM_MODEL;
  }

  async sttModell(): Promise<string> {
    return (await this.einstellung(KI_KEYS.STT_MODEL)) || process.env.STT_MODEL || 'whisper-1';
  }

  async firmenprofil(): Promise<string> {
    return (await this.einstellung(KI_KEYS.FIRMENPROFIL)) || DEFAULT_FIRMENPROFIL;
  }

  /** Herkunft eines Keys für die Status-Anzeige (nie der Wert selbst). */
  private async keyStatus(key: string, envName: string): Promise<'DB' | 'ENV' | 'FEHLT'> {
    const enc = await this.einstellung(key);
    if (enc && this.entschluessele(enc)) return 'DB';
    return process.env[envName] ? 'ENV' : 'FEHLT';
  }

  async status() {
    const [anthropic, openai, modell, stt, firmenprofil] = await Promise.all([
      this.keyStatus(KI_KEYS.ANTHROPIC_KEY_ENC, 'ANTHROPIC_API_KEY'),
      this.keyStatus(KI_KEYS.OPENAI_KEY_ENC, 'OPENAI_API_KEY'),
      this.llmModell(),
      this.sttModell(),
      this.firmenprofil(),
    ]);
    return { anthropicKey: anthropic, openaiKey: openai, llmModell: modell, sttModell: stt, firmenprofil, modelle: LLM_MODELLE };
  }

  // ─────────── Schreiben (nur ADMIN via Controller) ───────────

  private async setze(key: string, value: string | null): Promise<void> {
    if (value === null) {
      await this.prisma.einstellung.deleteMany({ where: { key } });
      return;
    }
    await this.prisma.einstellung.upsert({ where: { key }, update: { value }, create: { key, value, beschreibung: 'KI-Konfiguration (Admin-UI)' } });
  }

  async speichere(input: { llmModell?: string; sttModell?: string; anthropicKey?: string | null; openaiKey?: string | null; firmenprofil?: string }): Promise<void> {
    if (input.llmModell !== undefined) await this.setze(KI_KEYS.LLM_MODEL, input.llmModell.trim() || null);
    if (input.sttModell !== undefined) await this.setze(KI_KEYS.STT_MODEL, input.sttModell.trim() || null);
    // Keys: undefined = unverändert, '' oder null = löschen, sonst verschlüsselt speichern.
    if (input.anthropicKey !== undefined) await this.setze(KI_KEYS.ANTHROPIC_KEY_ENC, input.anthropicKey ? this.verschluessele(input.anthropicKey.trim()) : null);
    if (input.openaiKey !== undefined) await this.setze(KI_KEYS.OPENAI_KEY_ENC, input.openaiKey ? this.verschluessele(input.openaiKey.trim()) : null);
    if (input.firmenprofil !== undefined) await this.setze(KI_KEYS.FIRMENPROFIL, input.firmenprofil.trim() || null);
  }
}
