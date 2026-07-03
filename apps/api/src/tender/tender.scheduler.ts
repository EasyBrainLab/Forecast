import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TenderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { infoMail } from '../mail/mail.templates';
import { naechsteReminderSchwelle } from '@forecast/shared';

const TAG_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class TenderScheduler {
  private readonly logger = new Logger('TenderScheduler');

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  // Täglich 07:00 Europe/Berlin — Fristen prüfen, gestufte Erinnerungen versenden.
  @Cron('0 7 * * *', { timeZone: 'Europe/Berlin' })
  async fristenCheck(): Promise<void> {
    const heute = new Date();
    const offene = await this.prisma.tender.findMany({
      where: { status: { in: [TenderStatus.BEOBACHTET, TenderStatus.EINGEREICHT] }, abgabefrist: { gte: heute } },
    });
    for (const t of offene) {
      const restTage = Math.ceil((t.abgabefrist.getTime() - heute.getTime()) / TAG_MS);
      // Gestufte, idempotente Erinnerung (14/7/3/1 T) über die zuletzt gemeldete Schwelle — keine tägliche Wiederholung.
      const schwelle = naechsteReminderSchwelle(restTage, t.reminderSchwelleTage);
      if (schwelle === null) continue;

      try {
        const empfaenger = await this.empfaenger(t.regionCode);
        if (empfaenger.length) {
          const frist = t.abgabefrist.toLocaleDateString('de-DE');
          const text = `Ausschreibung „${t.referenznummer}" (${t.krankenhaus}) — Abgabefrist ${frist}, noch ${restTage} Tag(e). Status: ${t.status}.`;
          await Promise.all(empfaenger.map((email) => this.mail.send(email, infoMail('Tender-Frist naht', 'Ausschreibung fällig', text))));
        }
        await this.prisma.tender.update({ where: { id: t.id }, data: { reminderSchwelleTage: schwelle } });
      } catch (e) {
        this.logger.warn(`Tender-Reminder ${t.referenznummer} fehlgeschlagen: ${(e as Error).message}`);
      }
    }
  }

  /** Empfänger: zuständige AGM der Region; Fallback Vertriebs-/BU-Leitung, wenn keine Region/AGM. */
  private async empfaenger(regionCode: string | null): Promise<string[]> {
    if (regionCode) {
      const vs = await this.prisma.regionsVerantwortung.findMany({
        where: { regionCode, geloeschtAm: null, user: { rolle: 'AGM', status: 'VERIFIZIERT' } },
        select: { user: { select: { email: true } } },
      });
      if (vs.length) return [...new Set(vs.map((v) => v.user.email))];
    }
    const leitung = await this.prisma.user.findMany({
      where: { rolle: { in: ['VERTRIEBSLEITER', 'BU_LEITER'] }, status: 'VERIFIZIERT' },
      select: { email: true },
    });
    return leitung.map((u) => u.email);
  }
}
