import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ForecastStatus } from '@prisma/client';
import { EINSTELLUNG_KEYS, formatPeriode } from '@forecast/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { infoMail } from '../mail/mail.templates';
import { ForecastService } from './forecast.service';

@Injectable()
export class ForecastScheduler {
  private readonly logger = new Logger('ForecastScheduler');

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly forecast: ForecastService,
  ) {}

  private async deadlineTag(): Promise<number> {
    return Number((await this.prisma.einstellung.findUnique({ where: { key: EINSTELLUNG_KEYS.DEADLINE_TAG } }))?.value ?? 10);
  }

  // Täglich 08:00 — Erinnerung am (Deadline-3), Eskalation am (Deadline+1).
  @Cron('0 8 * * *', { timeZone: 'Europe/Berlin' })
  async dailyDeadlineCheck(): Promise<void> {
    const tag = await this.deadlineTag();
    const heute = new Date().getDate();
    if (heute === tag - 3) await this.erinnerung();
    if (heute === tag + 1) await this.eskalation();
  }

  private async erinnerung(): Promise<void> {
    const offen = await this.prisma.forecastPeriode.findMany({ where: { status: ForecastStatus.OFFEN } });
    for (const p of offen) {
      const vs = await this.prisma.regionsVerantwortung.findMany({ where: { regionCode: p.regionCode, geloeschtAm: null, user: { rolle: 'AGM', status: 'VERIFIZIERT' } }, select: { user: { select: { email: true } } } });
      await Promise.all(vs.map((v) => this.mail.send(v.user.email, infoMail('Forecast-Erinnerung', 'Bitte bestätigen', `Forecast ${p.periode} (${p.regionCode}) ist noch offen.`))));
    }
  }

  private async eskalation(): Promise<void> {
    const offen = await this.prisma.forecastPeriode.findMany({ where: { status: ForecastStatus.OFFEN } });
    if (!offen.length) return;
    const leitung = await this.prisma.user.findMany({ where: { rolle: { in: ['VERTRIEBSLEITER', 'BU_LEITER'] }, status: 'VERIFIZIERT' }, select: { email: true } });
    const liste = offen.map((p) => `${p.periode} ${p.regionCode}`).join(', ');
    await Promise.all(leitung.map((u) => this.mail.send(u.email, infoMail('Eskalation: offene Forecasts', 'Überfällig', `Noch offen: ${liste}`))));
  }

  // Monatlich 02:00 am 1. — Vormonat einfrieren (F6/F7/F8).
  @Cron('0 2 1 * *', { timeZone: 'Europe/Berlin' })
  async monatsabschluss(): Promise<void> {
    const jetzt = new Date();
    const vormonat = jetzt.getMonth() === 0 ? 12 : jetzt.getMonth();
    const jahr = jetzt.getMonth() === 0 ? jetzt.getFullYear() - 1 : jetzt.getFullYear();
    const periode = formatPeriode(jahr, vormonat);
    const offen = await this.prisma.forecastPeriode.findMany({
      where: { periode, status: { in: [ForecastStatus.OFFEN, ForecastStatus.BESTAETIGT, ForecastStatus.ANGEPASST] } },
    });
    const sys = await this.prisma.user.findFirst({ where: { rolle: 'ADMIN' }, select: { id: true } });
    if (!sys) return;
    const system = { id: sys.id, email: 'SYSTEM', rolle: 'BU_LEITER' as const };
    for (const p of offen) {
      try {
        await this.forecast.abschliessen(p.periode, p.regionCode, system);
      } catch (e) {
        this.logger.warn(`Abschluss ${p.periode}/${p.regionCode} fehlgeschlagen: ${(e as Error).message}`);
      }
    }
  }
}
