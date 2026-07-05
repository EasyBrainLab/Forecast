import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EINSTELLUNG_KEYS, formatPeriode } from '@forecast/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { infoMail } from '../mail/mail.templates';

/** Fristenlogik Monatsbericht: fällig am REPORT_DEADLINE_TAG (Default 10.) des Folgemonats für den Vormonat. */
@Injectable()
export class ReportScheduler {
  private readonly logger = new Logger('ReportScheduler');

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  private async deadlineTag(): Promise<number> {
    return Number((await this.prisma.einstellung.findUnique({ where: { key: EINSTELLUNG_KEYS.REPORT_DEADLINE_TAG } }))?.value ?? 10);
  }

  /** Berichtsperiode = Vormonat des heutigen Datums. */
  private vormonatsPeriode(): string {
    const jetzt = new Date();
    const monat = jetzt.getMonth() === 0 ? 12 : jetzt.getMonth();
    const jahr = jetzt.getMonth() === 0 ? jetzt.getFullYear() - 1 : jetzt.getFullYear();
    return formatPeriode(jahr, monat);
  }

  /** Regionen ohne eingereichten Bericht für die Periode. */
  private async offeneRegionen(periode: string): Promise<{ code: string; bezeichnung: string }[]> {
    const regionen = await this.prisma.region.findMany({ where: { forecastRelevant: true }, select: { code: true, bezeichnung: true } });
    const eingereicht = await this.prisma.monthlyReport.findMany({ where: { periode, status: { in: ['EINGEREICHT', 'GELESEN'] } }, select: { regionCode: true } });
    const done = new Set(eingereicht.map((r) => r.regionCode));
    return regionen.filter((r) => !done.has(r.code));
  }

  // Täglich 08:15 Europe/Berlin — Erinnerung am (Frist-3), Eskalation am (Frist+1).
  @Cron('15 8 * * *', { timeZone: 'Europe/Berlin' })
  async dailyDeadlineCheck(): Promise<void> {
    const tag = await this.deadlineTag();
    const heute = new Date().getDate();
    if (heute === tag - 3) await this.erinnerung();
    if (heute === tag + 1) await this.eskalation();
  }

  private async erinnerung(): Promise<void> {
    const periode = this.vormonatsPeriode();
    const tag = await this.deadlineTag();
    const offen = await this.offeneRegionen(periode);
    for (const region of offen) {
      const vs = await this.prisma.regionsVerantwortung.findMany({
        where: { regionCode: region.code, geloeschtAm: null, user: { rolle: 'AGM', status: 'VERIFIZIERT' } },
        select: { user: { select: { email: true } } },
      });
      await Promise.all(
        vs.map((v) =>
          this.mail.send(v.user.email, infoMail('Monatsbericht fällig', 'Bitte einreichen', `Der Vertriebs-Monatsbericht ${periode} (${region.code}) ist noch nicht eingereicht. Frist: ${tag}. des Monats.`)),
        ),
      );
    }
  }

  private async eskalation(): Promise<void> {
    const periode = this.vormonatsPeriode();
    const offen = await this.offeneRegionen(periode);
    if (!offen.length) return;
    const leitung = await this.prisma.user.findMany({ where: { rolle: { in: ['VERTRIEBSLEITER', 'BU_LEITER'] }, status: 'VERIFIZIERT' }, select: { email: true } });
    const liste = offen.map((r) => r.code).join(', ');
    try {
      await Promise.all(leitung.map((u) => this.mail.send(u.email, infoMail('Eskalation: Monatsberichte überfällig', 'Überfällig', `Monatsbericht ${periode} fehlt noch von: ${liste}`))));
    } catch (e) {
      this.logger.warn(`Report-Eskalation fehlgeschlagen: ${(e as Error).message}`);
    }
  }
}
