import { BadRequestException, HttpException, Injectable, UnauthorizedException } from '@nestjs/common';

// HTTP 423 Locked (Account-Lockout); in dieser Nest-Version nicht als HttpStatus-Enum vorhanden.
const HTTP_LOCKED = 423;
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { kontoGesperrtMail, passwortResetMail } from '../mail/mail.templates';
import { generateToken, hashToken } from '../common/util/token.util';
import { validatePasswortPolicy } from './passwort.policy';

export interface LoginErgebnis {
  accessToken: string;
  user: { id: string; email: string; name: string; rolle: string; passwortWechselPflicht: boolean };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  private issueToken(user: Pick<User, 'id' | 'email' | 'rolle'>): string {
    return this.jwt.sign({ sub: user.id, email: user.email, rolle: user.rolle });
  }

  private erfolg(user: User): LoginErgebnis {
    return {
      accessToken: this.issueToken(user),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        rolle: user.rolle,
        passwortWechselPflicht: user.passwortWechselPflicht,
      },
    };
  }

  async login(emailRaw: string, passwort: string, ip?: string): Promise<LoginErgebnis> {
    const email = emailRaw.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Kein User-Enumeration: generisches 401 bei unbekanntem/nicht verifiziertem Konto.
    if (!user || user.status !== 'VERIFIZIERT' || !user.passwortHash) {
      throw new UnauthorizedException('Anmeldung fehlgeschlagen.');
    }
    if (user.gesperrtBis && user.gesperrtBis > new Date()) {
      throw new HttpException('Konto vorübergehend gesperrt.', HTTP_LOCKED);
    }
    const passt = await bcrypt.compare(passwort, user.passwortHash);
    if (!passt) {
      await this.registriereFehlversuch(user, ip);
      throw new UnauthorizedException('Anmeldung fehlgeschlagen.');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { fehlversuche: 0, gesperrtBis: null, letzterLogin: new Date() },
    });
    await this.audit.write({ entitaet: 'User', entitaetId: user.id, aktion: 'LOGIN', userId: user.id, userEmail: email, ipAdresse: ip });
    return this.erfolg(user);
  }

  private async registriereFehlversuch(user: User, ip?: string): Promise<void> {
    const max = Number(this.config.get('LOCKOUT_MAX_ATTEMPTS') ?? 5);
    const fenster = Number(this.config.get('LOCKOUT_WINDOW_MIN') ?? 30);
    const neu = user.fehlversuche + 1;
    if (neu >= max) {
      const gesperrtBis = new Date(Date.now() + fenster * 60_000);
      await this.prisma.user.update({ where: { id: user.id }, data: { fehlversuche: 0, gesperrtBis } });
      await this.audit.write({ entitaet: 'User', entitaetId: user.id, aktion: 'LOGIN_FEHLER', userId: user.id, userEmail: user.email, ipAdresse: ip, metadaten: { gesperrt: true } });
      await this.mail.send(user.email, kontoGesperrtMail(fenster));
    } else {
      await this.prisma.user.update({ where: { id: user.id }, data: { fehlversuche: neu } });
      await this.audit.write({ entitaet: 'User', entitaetId: user.id, aktion: 'LOGIN_FEHLER', userId: user.id, userEmail: user.email, ipAdresse: ip, metadaten: { fehlversuche: neu } });
    }
  }

  async validateInvitation(token: string): Promise<{ email: string; name: string }> {
    const user = await this.prisma.user.findUnique({ where: { einladungTokenHash: hashToken(token) } });
    if (!user || user.status !== 'EINGELADEN' || !user.einladungAblauf || user.einladungAblauf < new Date()) {
      throw new BadRequestException('Einladung ungültig oder abgelaufen.');
    }
    return { email: user.email, name: user.name };
  }

  async acceptInvitation(token: string, passwort: string): Promise<LoginErgebnis> {
    const user = await this.prisma.user.findUnique({ where: { einladungTokenHash: hashToken(token) } });
    if (!user || user.status !== 'EINGELADEN' || !user.einladungAblauf || user.einladungAblauf < new Date()) {
      throw new BadRequestException('Einladung ungültig oder abgelaufen.');
    }
    validatePasswortPolicy(passwort, user.email);
    const passwortHash = await bcrypt.hash(passwort, Number(this.config.get('BCRYPT_ROUNDS') ?? 12));
    const aktualisiert = await this.prisma.user.update({
      where: { id: user.id },
      data: { passwortHash, status: 'VERIFIZIERT', einladungTokenHash: null, einladungAblauf: null, passwortWechselPflicht: false },
    });
    await this.audit.write({ entitaet: 'User', entitaetId: user.id, aktion: 'STATUS_WECHSEL', userId: user.id, userEmail: user.email, nachherWert: { status: 'VERIFIZIERT' } });
    return this.erfolg(aktualisiert);
  }

  async forgotPassword(emailRaw: string): Promise<void> {
    const email = emailRaw.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Immer 204 (kein Leak): nur bei gültigem, verifiziertem Konto wird tatsächlich gesendet.
    if (!user || user.status !== 'VERIFIZIERT') return;
    const { token, hash } = generateToken();
    const stunden = Number(this.config.get('RESET_TOKEN_TTL_HOURS') ?? 2);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { resetTokenHash: hash, resetAblauf: new Date(Date.now() + stunden * 3_600_000) },
    });
    const url = `${this.config.get('APP_BASE_URL')}/passwort-reset?token=${token}`;
    await this.mail.send(email, passwortResetMail(url, stunden));
  }

  async resetPassword(token: string, passwort: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { resetTokenHash: hashToken(token) } });
    if (!user || !user.resetAblauf || user.resetAblauf < new Date()) {
      throw new BadRequestException('Reset-Link ungültig oder abgelaufen.');
    }
    validatePasswortPolicy(passwort, user.email);
    const passwortHash = await bcrypt.hash(passwort, Number(this.config.get('BCRYPT_ROUNDS') ?? 12));
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwortHash, resetTokenHash: null, resetAblauf: null, fehlversuche: 0, gesperrtBis: null, passwortWechselPflicht: false },
    });
    await this.audit.write({ entitaet: 'User', entitaetId: user.id, aktion: 'UPDATE', userId: user.id, userEmail: user.email, metadaten: { passwortReset: true } });
  }

  async changePassword(userId: string, altesPasswort: string, neuesPasswort: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwortHash) throw new UnauthorizedException();
    const passt = await bcrypt.compare(altesPasswort, user.passwortHash);
    if (!passt) throw new BadRequestException('Aktuelles Passwort ist falsch.');
    validatePasswortPolicy(neuesPasswort, user.email);
    const passwortHash = await bcrypt.hash(neuesPasswort, Number(this.config.get('BCRYPT_ROUNDS') ?? 12));
    await this.prisma.user.update({ where: { id: userId }, data: { passwortHash, passwortWechselPflicht: false } });
    await this.audit.write({ entitaet: 'User', entitaetId: userId, aktion: 'UPDATE', userId, userEmail: user.email, metadaten: { passwortGeaendert: true } });
  }

  async me(userId: string): Promise<{ id: string; email: string; name: string; rolle: string; passwortWechselPflicht: boolean }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { id: user.id, email: user.email, name: user.name, rolle: user.rolle, passwortWechselPflicht: user.passwortWechselPflicht };
  }
}
