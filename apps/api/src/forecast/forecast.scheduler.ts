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

  /**
   * Monatlich 02:00 am 1. — alles bis einschließlich Vormonat einfrieren (F6/F7/F8).
   * Je Region wird die jüngste noch offene Periode abgeschlossen; die Kaskade in `abschliessen` zieht
   * die älteren mit. So bleiben keine Altperioden dauerhaft offen, wenn ein Lauf einmal ausfällt.
   */
  @Cron('0 2 1 * *', { timeZone: 'Europe/Berlin' })
  async monatsabschluss(): Promise<void> {
    const jetzt = new Date();
    const vormonat = jetzt.getMonth() === 0 ? 12 : jetzt.getMonth();
    const jahr = jetzt.getMonth() === 0 ? jetzt.getFullYear() - 1 : jetzt.getFullYear();
    const offen = await this.prisma.forecastPeriode.findMany({
      where: {
        status: { in: [ForecastStatus.OFFEN, ForecastStatus.BESTAETIGT, ForecastStatus.ANGEPASST] },
        OR: [{ jahr: { lt: jahr } }, { jahr, monat: { lte: vormonat } }],
      },
      orderBy: [{ regionCode: 'asc' }, { jahr: 'desc' }, { monat: 'desc' }],
    });
    const sys = await this.prisma.user.findFirst({ where: { rolle: 'ADMIN' }, select: { id: true } });
    if (!sys) return;
    const system = { id: sys.id, email: 'SYSTEM', rolle: 'BU_LEITER' as const };
    const juengstePro = new Map<string, (typeof offen)[number]>();
    for (const p of offen) if (!juengstePro.has(p.regionCode)) juengstePro.set(p.regionCode, p);
    for (const p of juengstePro.values()) {
      try {
        const r = await this.forecast.abschliessen(p.periode, p.regionCode, system, { system: true });
        this.logger.log(`Abschluss ${p.regionCode}: ${r.abgeschlossen.join(', ')}`);
      } catch (e) {
        this.logger.warn(`Abschluss ${p.periode}/${p.regionCode} fehlgeschlagen: ${(e as Error).message}`);
      }
    }
  }

  /**
   * Monatlich 03:00 am 1. (nach dem Abschluss um 02:00) — die Periode des laufenden Monats für alle
   * forecast-relevanten Regionen öffnen. So schreitet die aktive Periode monatlich fort und der zuletzt
   * abgeschlossene Vormonat wird zum Actual (sein Ist erscheint in der Monatssicht). Idempotent, da
   * oeffnePeriode je Region/Periode nur einmal seedet.
   */
  @Cron('0 3 1 * *', { timeZone: 'Europe/Berlin' })
  async neuePeriodeOeffnen(): Promise<void> {
    const jetzt = new Date();
    await this.oeffneAktuellePeriode(formatPeriode(jetzt.getFullYear(), jetzt.getMonth() + 1));
  }

  /** Öffnet die angegebene Periode für alle forecast-relevanten Regionen (idempotent). */
  async oeffneAktuellePeriode(periode: string): Promise<{ periode: string; geoeffnet: number }> {
    const sys = await this.prisma.user.findFirst({ where: { rolle: 'ADMIN' }, select: { id: true, email: true } });
    if (!sys) return { periode, geoeffnet: 0 };
    const system = { id: sys.id, email: 'SYSTEM', rolle: 'ADMIN' as const };
    const regionen = await this.prisma.region.findMany({ where: { forecastRelevant: true }, select: { code: true } });
    let ok = 0;
    for (const r of regionen) {
      try {
        await this.forecast.oeffnePeriode(periode, r.code, system);
        ok++;
      } catch (e) {
        this.logger.warn(`Öffnen ${periode}/${r.code} fehlgeschlagen: ${(e as Error).message}`);
      }
    }
    this.logger.log(`Periode ${periode} geöffnet für ${ok}/${regionen.length} Region(en).`);
    return { periode, geoeffnet: ok };
  }
}
