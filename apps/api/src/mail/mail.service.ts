import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { AuditService } from '../audit/audit.service';
import type { MailInhalt } from './mail.templates';

@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  private readonly transporter: nodemailer.Transporter;
  private readonly from: string;

  constructor(
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {
    const host = this.config.get<string>('SMTP_HOST');
    const port = Number(this.config.get<string>('SMTP_PORT') ?? 587);
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    this.from = this.config.get<string>('SMTP_FROM') ?? 'Forecast-Portal <noreply@localhost>';
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user ? { user, pass } : undefined,
    });
  }

  /** Versand mit 1 Retry; Fehler werden geloggt + als AuditTrail (MAIL_FEHLER) festgehalten, brechen aber nichts ab. */
  async send(to: string, inhalt: MailInhalt): Promise<boolean> {
    for (let versuch = 1; versuch <= 2; versuch++) {
      try {
        await this.transporter.sendMail({
          from: this.from,
          to,
          subject: inhalt.subject,
          html: inhalt.html,
          text: inhalt.text,
        });
        return true;
      } catch (err) {
        if (versuch === 2) {
          this.logger.warn(`Mailversand an ${to} fehlgeschlagen: ${(err as Error).message}`);
          await this.audit
            .write({ entitaet: 'Mail', aktion: 'MAIL_FEHLER', userEmail: to, metadaten: { subject: inhalt.subject } })
            .catch(() => undefined);
          return false;
        }
      }
    }
    return false;
  }
}
