import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma, VoiceSession } from '@prisma/client';
import { EINSTELLUNG_KEYS, findeSiteKandidaten, normalizeSiteName } from '@forecast/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../scope/scope.service';
import { SttService, LlmExtraktionService, VOICE_SPRACHEN, type Extraktion } from './voice.providers';
import type { RequestUser } from '../common/decorators/current-user.decorator';

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const TAG_MS = 24 * 60 * 60 * 1000;

/** Extraktion, angereichert um Stammdaten-Matches (IDs als Vorschlag; Bestätigung bleibt beim Nutzer). */
export interface AngereicherteExtraktion extends Extraktion {
  eintraege: (Extraktion['eintraege'][number] & {
    customerSiteId: string | null;
    customerSiteMatchName: string | null;
    competitorId: string | null;
  })[];
}

@Injectable()
export class VoiceService {
  private readonly logger = new Logger('VoiceService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly stt: SttService,
    private readonly llm: LlmExtraktionService,
  ) {}

  /** Feature-Detection fürs Frontend (Keys bleiben serverseitig; nur Verfügbarkeit wird verraten). */
  async status() {
    const [sttProvider, llmProvider] = await Promise.all([this.stt.provider(), this.llm.provider()]);
    return {
      verfuegbar: sttProvider !== 'aus' && llmProvider !== 'aus',
      stt: sttProvider,
      llm: llmProvider,
      sprachen: VOICE_SPRACHEN,
    };
  }

  private parsePeriode(periode: string): void {
    if (!/^\d{4}-\d{2}$/.test(periode)) throw new BadRequestException('Periode muss Format JJJJ-MM haben.');
  }

  private async assertSchreibbar(aktor: RequestUser, regionCode: string): Promise<void> {
    if (aktor.rolle !== 'AGM' && aktor.rolle !== 'ADMIN') throw new ForbiddenException('Nur AGM diktieren Monatsberichte.');
    if (aktor.rolle === 'AGM') {
      const s = await this.scope.getScope(aktor);
      this.scope.assertSchreibScope(s, regionCode);
    }
  }

  private async holeEigene(id: string, aktor: RequestUser): Promise<VoiceSession> {
    const session = await this.prisma.voiceSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('Diktat nicht gefunden.');
    await this.assertSchreibbar(aktor, session.regionCode);
    if (aktor.rolle === 'AGM' && session.userId !== aktor.id) throw new ForbiddenException('Nur das eigene Diktat.');
    return session;
  }

  private toDto(s: VoiceSession) {
    return {
      id: s.id,
      periode: s.periode,
      regionCode: s.regionCode,
      sprache: s.sprache,
      status: s.status,
      transkript: s.transkript,
      extraktion: s.extraktion as unknown as AngereicherteExtraktion | null,
      audioGespeichert: s.audio !== null,
      erstelltAm: s.erstelltAm,
    };
  }

  // ─────────── Flow: Upload -> Transkript ───────────

  async upload(audio: Buffer, mimeType: string, periode: string, regionCode: string, spracheHint: string | undefined, aktor: RequestUser) {
    this.parsePeriode(periode);
    await this.assertSchreibbar(aktor, regionCode);
    if (!audio?.length) throw new BadRequestException('Keine Audiodaten übergeben.');
    if (audio.length > MAX_AUDIO_BYTES) throw new BadRequestException('Aufnahme zu groß (max. 25 MB).');

    const ergebnis = await this.stt.transkribiere(audio, mimeType, spracheHint ?? null);
    if (!ergebnis.text.trim()) throw new BadRequestException('Kein Sprachinhalt erkannt — bitte erneut aufnehmen.');

    const session = await this.prisma.voiceSession.create({
      data: {
        periode,
        regionCode,
        userId: aktor.id,
        userEmail: aktor.email,
        sprache: ergebnis.sprache,
        status: 'TRANSKRIBIERT',
        audio,
        audioMimeType: mimeType,
        audioGroesse: audio.length,
        transkript: ergebnis.text,
        sttProvider: await this.stt.provider(),
      },
    });
    await this.audit.write({ entitaet: 'VoiceSession', entitaetId: session.id, aktion: 'CREATE', userId: aktor.id, userEmail: aktor.email, metadaten: { periode, regionCode, bytes: audio.length, sprache: ergebnis.sprache } });
    return this.toDto(session);
  }

  // ─────────── Flow: Transkript -> strukturierte Extraktion (mit Stammdaten-Matching) ───────────

  async extrahieren(id: string, aktor: RequestUser) {
    const session = await this.holeEigene(id, aktor);
    const roh = await this.llm.extrahiere(session.transkript);
    const angereichert = await this.matcheStammdaten(roh);
    const llmProvider = await this.llm.provider();
    const updated = await this.prisma.voiceSession.update({
      where: { id },
      data: { status: 'EXTRAHIERT', extraktion: angereichert as unknown as Prisma.InputJsonValue, llmModell: llmProvider === 'anthropic' ? await this.llm.modell() : 'mock' },
    });
    await this.audit.write({ entitaet: 'VoiceSession', entitaetId: id, aktion: 'UPDATE', userId: aktor.id, userEmail: aktor.email, metadaten: { schritt: 'EXTRAKTION', eintraege: angereichert.eintraege.length, zahlen: angereichert.zahlen.length } });
    return this.toDto(updated);
  }

  /** Matcht diktierte Kunden-/Wettbewerbernamen gegen Stammdaten (Vorschlag, keine Auto-Übernahme). */
  private async matcheStammdaten(e: Extraktion): Promise<AngereicherteExtraktion> {
    const [sites, wettbewerber] = await Promise.all([
      this.prisma.customerSite.findMany({ select: { id: true, name: true } }),
      this.prisma.competitor.findMany({ where: { aktiv: true }, select: { id: true, name: true } }),
    ]);
    const wbByNorm = new Map(wettbewerber.map((w) => [normalizeSiteName(w.name), w.id]));
    return {
      ...e,
      eintraege: e.eintraege.map((it) => {
        let customerSiteId: string | null = null;
        let customerSiteMatchName: string | null = null;
        if (it.kundeName) {
          const treffer = findeSiteKandidaten(it.kundeName, sites, 0.5, 1)[0];
          if (treffer) {
            customerSiteId = treffer.id;
            customerSiteMatchName = treffer.name;
          }
        }
        let competitorId: string | null = null;
        if (it.wettbewerberName) competitorId = wbByNorm.get(normalizeSiteName(it.wettbewerberName)) ?? null;
        return { ...it, customerSiteId, customerSiteMatchName, competitorId };
      }),
    };
  }

  // ─────────── Bestätigen / Verwerfen + Audio-Retention ───────────

  /** Nutzer hat alle Zahlen geprüft und die Werte in die Maske übernommen — Audio gemäß Einstellung löschen. */
  async bestaetigen(id: string, aktor: RequestUser) {
    const session = await this.holeEigene(id, aktor);
    if (session.status !== 'EXTRAHIERT') throw new BadRequestException('Erst extrahieren, dann bestätigen.');
    const aufbewahrung = (await this.prisma.einstellung.findUnique({ where: { key: EINSTELLUNG_KEYS.AUDIO_AUFBEWAHRUNG } }))?.value ?? 'SOFORT_LOESCHEN';
    const audioLoeschen = aufbewahrung === 'SOFORT_LOESCHEN';
    const updated = await this.prisma.voiceSession.update({
      where: { id },
      data: { status: 'BESTAETIGT', bestaetigtAm: new Date(), ...(audioLoeschen ? { audio: null } : {}) },
    });
    await this.audit.write({ entitaet: 'VoiceSession', entitaetId: id, aktion: 'STATUS_WECHSEL', userId: aktor.id, userEmail: aktor.email, vorherWert: { status: session.status }, nachherWert: { status: 'BESTAETIGT', audioGeloescht: audioLoeschen } });
    return this.toDto(updated);
  }

  async verwerfen(id: string, aktor: RequestUser) {
    const session = await this.holeEigene(id, aktor);
    const updated = await this.prisma.voiceSession.update({ where: { id }, data: { status: 'VERWORFEN', audio: null } });
    await this.audit.write({ entitaet: 'VoiceSession', entitaetId: id, aktion: 'STATUS_WECHSEL', userId: aktor.id, userEmail: aktor.email, vorherWert: { status: session.status }, nachherWert: { status: 'VERWORFEN' } });
    return this.toDto(updated);
  }

  // Täglich 03:30 — Audio-Aufbewahrung TAGE_30: Aufnahmen älter als 30 Tage löschen (Transkript bleibt als Audit).
  @Cron('30 3 * * *', { timeZone: 'Europe/Berlin' })
  async audioRetention(): Promise<void> {
    const aufbewahrung = (await this.prisma.einstellung.findUnique({ where: { key: EINSTELLUNG_KEYS.AUDIO_AUFBEWAHRUNG } }))?.value ?? 'SOFORT_LOESCHEN';
    if (aufbewahrung !== 'TAGE_30') return;
    const grenze = new Date(Date.now() - 30 * TAG_MS);
    const { count } = await this.prisma.voiceSession.updateMany({ where: { erstelltAm: { lt: grenze }, audio: { not: null } }, data: { audio: null } });
    if (count > 0) this.logger.log(`Audio-Retention: ${count} Aufnahme(n) älter 30 Tage gelöscht.`);
  }
}
