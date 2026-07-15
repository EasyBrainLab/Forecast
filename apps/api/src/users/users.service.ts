import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Rolle, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { einladungMail } from '../mail/mail.templates';
import { generateToken } from '../common/util/token.util';
import { pickDefined } from '../common/util/whitelist.util';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { CreateUserDto, UpdateUserDto } from './users.dto';

const USER_PUBLIC = {
  id: true,
  email: true,
  name: true,
  rolle: true,
  status: true,
  letzterLogin: true,
  erstelltAm: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  /** Reichert einen Nutzer-Datensatz um seine aktiven Region-Codes an (für AGM-Scope-Anzeige). */
  private mitRegionen<T extends { verantwortungen: { regionCode: string }[] }>(u: T) {
    const { verantwortungen, ...rest } = u;
    return { ...rest, regionCodes: verantwortungen.map((v) => v.regionCode) };
  }

  async list() {
    const users = await this.prisma.user.findMany({
      select: { ...USER_PUBLIC, verantwortungen: { where: { geloeschtAm: null }, select: { regionCode: true } } },
      orderBy: { erstelltAm: 'asc' },
    });
    return users.map((u) => this.mitRegionen(u));
  }

  async get(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { ...USER_PUBLIC, verantwortungen: { where: { geloeschtAm: null }, select: { regionCode: true } } },
    });
    if (!user) throw new NotFoundException('Nutzer nicht gefunden.');
    return this.mitRegionen(user);
  }

  /** Wirft, wenn die Aktion den letzten aktiven Administrator entfernen würde (Aussperr-Schutz). */
  private async assertNichtLetzterAdmin(id: string, was: string): Promise<void> {
    const andereAdmins = await this.prisma.user.count({
      where: { id: { not: id }, rolle: Rolle.ADMIN, status: { not: UserStatus.DEAKTIVIERT } },
    });
    if (andereAdmins === 0) throw new BadRequestException(`Der letzte aktive Administrator kann nicht ${was} werden.`);
  }

  /**
   * Setzt die aktiven Region-Zuordnungen eines Nutzers auf `sollCodes` (Diff: fehlende soft-schließen,
   * neue anlegen). `[]` schließt alle — z. B. bei Rollenwechsel weg von AGM.
   */
  private async syncRegionen(tx: Prisma.TransactionClient, userId: string, sollCodes: string[]): Promise<void> {
    const aktiv = await tx.regionsVerantwortung.findMany({ where: { userId, geloeschtAm: null }, select: { id: true, regionCode: true } });
    const aktivCodes = new Set(aktiv.map((v) => v.regionCode));
    const soll = new Set(sollCodes);
    const zuSchliessen = aktiv.filter((v) => !soll.has(v.regionCode)).map((v) => v.id);
    if (zuSchliessen.length) await tx.regionsVerantwortung.updateMany({ where: { id: { in: zuSchliessen } }, data: { geloeschtAm: new Date() } });
    const zuErstellen = [...soll].filter((c) => !aktivCodes.has(c));
    if (zuErstellen.length) await tx.regionsVerantwortung.createMany({ data: zuErstellen.map((regionCode) => ({ userId, regionCode, gueltigVon: new Date() })) });
  }

  /** Legt einen Nutzer im Status EINGELADEN an und versendet den Invitation-Link. */
  async invite(dto: CreateUserDto, aktor: RequestUser) {
    const email = dto.email.toLowerCase();
    const existiert = await this.prisma.user.findUnique({ where: { email } });
    if (existiert) throw new BadRequestException('E-Mail bereits vergeben.');

    const { token, hash } = generateToken();
    const tage = Number(this.config.get('INVITATION_TOKEN_TTL_DAYS') ?? 7);
    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name,
        rolle: dto.rolle as Rolle,
        status: UserStatus.EINGELADEN,
        einladungTokenHash: hash,
        einladungAblauf: new Date(Date.now() + tage * 86_400_000),
      },
      select: USER_PUBLIC,
    });
    // AGM: Region(en) als RegionsVerantwortung zuordnen (Scope). Sonst hätte der AGM keine Daten.
    if (dto.rolle === 'AGM' && dto.regionCodes?.length) {
      await this.prisma.regionsVerantwortung.createMany({
        data: dto.regionCodes.map((regionCode) => ({ userId: user.id, regionCode, gueltigVon: new Date() })),
      });
    }
    const einladungUrl = `${this.config.get('APP_BASE_URL')}/einladung/${token}`;
    await this.mail.send(email, einladungMail(dto.name, einladungUrl, tage));
    await this.audit.write({ entitaet: 'User', entitaetId: user.id, aktion: 'CREATE', userId: aktor.id, userEmail: aktor.email, nachherWert: { email, rolle: dto.rolle, regionCodes: dto.regionCodes ?? [] } });
    return { ...user, einladungUrl, regionCodes: dto.regionCodes ?? [] };
  }

  async reinvite(id: string, aktor: RequestUser) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Nutzer nicht gefunden.');
    if (user.status === UserStatus.DEAKTIVIERT) throw new BadRequestException('Nutzer ist deaktiviert.');
    const { token, hash } = generateToken();
    const tage = Number(this.config.get('INVITATION_TOKEN_TTL_DAYS') ?? 7);
    await this.prisma.user.update({
      where: { id },
      data: { status: UserStatus.EINGELADEN, einladungTokenHash: hash, einladungAblauf: new Date(Date.now() + tage * 86_400_000) },
    });
    const einladungUrl = `${this.config.get('APP_BASE_URL')}/einladung/${token}`;
    await this.mail.send(user.email, einladungMail(user.name, einladungUrl, tage));
    await this.audit.write({ entitaet: 'User', entitaetId: id, aktion: 'UPDATE', userId: aktor.id, userEmail: aktor.email, metadaten: { reinvite: true } });
    return { einladungUrl };
  }

  /** Ändert Name/Rolle und pflegt die AGM-Region-Zuordnung. Rollenwechsel weg von AGM schließt Regionen. */
  async update(id: string, dto: UpdateUserDto, aktor: RequestUser) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { verantwortungen: { where: { geloeschtAm: null } } } });
    if (!user) throw new NotFoundException('Nutzer nicht gefunden.');
    const zielRolle = (dto.rolle as Rolle | undefined) ?? user.rolle;

    // Aussperr-Schutz: den letzten aktiven Admin nicht herabstufen.
    if (user.rolle === Rolle.ADMIN && zielRolle !== Rolle.ADMIN) await this.assertNichtLetzterAdmin(id, 'herabgestuft');

    // AGM braucht mindestens eine Region, sonst sieht er (fail-closed) keine Daten.
    const wirdAgm = zielRolle === Rolle.AGM;
    const sollRegionen = wirdAgm ? (dto.regionCodes ?? user.verantwortungen.map((v) => v.regionCode)) : [];
    if (wirdAgm && sollRegionen.length === 0) {
      throw new BadRequestException('Für die Rolle AGM muss mindestens eine Region zugeordnet sein.');
    }

    // Whitelist-PATCH: nur explizit erlaubte Skalarfelder.
    const daten = pickDefined(dto, ['name', 'rolle'] as const);
    const aktualisiert = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({ where: { id }, data: daten as Prisma.UserUpdateInput, select: USER_PUBLIC });
      // Regionen immer auf den Sollzustand bringen (auch [] bei Nicht-AGM → alte Zuordnungen schließen).
      await this.syncRegionen(tx, id, sollRegionen);
      return u;
    });
    await this.audit.write({
      entitaet: 'User',
      entitaetId: id,
      aktion: 'UPDATE',
      userId: aktor.id,
      userEmail: aktor.email,
      vorherWert: { rolle: user.rolle, regionCodes: user.verantwortungen.map((v) => v.regionCode) },
      nachherWert: { ...daten, regionCodes: sollRegionen },
    });
    return { ...aktualisiert, regionCodes: sollRegionen };
  }

  /** Sperrt den Login (Status DEAKTIVIERT). Historie bleibt erhalten; reversibel via reaktivieren. */
  async deaktivieren(id: string, aktor: RequestUser) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Nutzer nicht gefunden.');
    if (id === aktor.id) throw new BadRequestException('Sie können sich nicht selbst deaktivieren.');
    if (user.status === UserStatus.DEAKTIVIERT) return this.get(id);
    if (user.rolle === Rolle.ADMIN) await this.assertNichtLetzterAdmin(id, 'deaktiviert');
    await this.prisma.user.update({ where: { id }, data: { status: UserStatus.DEAKTIVIERT } });
    await this.audit.write({ entitaet: 'User', entitaetId: id, aktion: 'UPDATE', userId: aktor.id, userEmail: aktor.email, vorherWert: { status: user.status }, nachherWert: { status: 'DEAKTIVIERT' } });
    return this.get(id);
  }

  /** Hebt eine Deaktivierung auf: VERIFIZIERT bei vorhandenem Passwort, sonst zurück auf EINGELADEN. */
  async reaktivieren(id: string, aktor: RequestUser) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Nutzer nicht gefunden.');
    const neu = user.passwortHash ? UserStatus.VERIFIZIERT : UserStatus.EINGELADEN;
    await this.prisma.user.update({ where: { id }, data: { status: neu } });
    await this.audit.write({ entitaet: 'User', entitaetId: id, aktion: 'UPDATE', userId: aktor.id, userEmail: aktor.email, vorherWert: { status: user.status }, nachherWert: { status: neu } });
    return this.get(id);
  }

  /**
   * Physisches Löschen — nur zulässig, wenn der Nutzer keinerlei auditrelevante Historie hat
   * (z. B. Fehleinladung). Andernfalls BadRequest mit Verweis auf Deaktivieren, weil Forecast-/Budget-
   * Spuren append-only sind und den Nutzer referenzieren.
   */
  async remove(id: string, aktor: RequestUser) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Nutzer nicht gefunden.');
    if (id === aktor.id) throw new BadRequestException('Sie können sich nicht selbst löschen.');
    if (user.rolle === Rolle.ADMIN) await this.assertNichtLetzterAdmin(id, 'gelöscht');

    const [fv, ba, be, ib, se] = await Promise.all([
      this.prisma.forecastVersion.count({ where: { userId: id } }),
      this.prisma.budgetAenderung.count({ where: { antragstellerId: id } }),
      this.prisma.budgetAenderungEvent.count({ where: { byUserId: id } }),
      this.prisma.importBatch.count({ where: { ausgeloestVonId: id } }),
      this.prisma.sondereffekt.count({ where: { erstelltVonId: id } }),
    ]);
    const historie = fv + ba + be + ib + se;
    if (historie > 0) {
      throw new BadRequestException(
        `Nutzer hat ${historie} Historien-Einträge (Forecast/Budget/Import) und kann nicht gelöscht werden. Bitte stattdessen deaktivieren.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.regionsVerantwortung.deleteMany({ where: { userId: id } });
      await tx.user.delete({ where: { id } });
    });
    await this.audit.write({ entitaet: 'User', entitaetId: id, aktion: 'DELETE', userId: aktor.id, userEmail: aktor.email, vorherWert: { email: user.email, rolle: user.rolle } });
    return { geloescht: true, id };
  }
}
