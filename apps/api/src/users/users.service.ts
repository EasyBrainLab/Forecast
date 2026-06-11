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

  async list() {
    return this.prisma.user.findMany({ select: USER_PUBLIC, orderBy: { erstelltAm: 'asc' } });
  }

  async get(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: USER_PUBLIC });
    if (!user) throw new NotFoundException('Nutzer nicht gefunden.');
    return user;
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
    const einladungUrl = `${this.config.get('APP_BASE_URL')}/einladung/${token}`;
    await this.mail.send(email, einladungMail(dto.name, einladungUrl, tage));
    await this.audit.write({ entitaet: 'User', entitaetId: user.id, aktion: 'CREATE', userId: aktor.id, userEmail: aktor.email, nachherWert: { email, rolle: dto.rolle } });
    return { ...user, einladungUrl };
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

  async update(id: string, dto: UpdateUserDto, aktor: RequestUser) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Nutzer nicht gefunden.');
    // Whitelist-PATCH: nur explizit erlaubte Felder.
    const daten = pickDefined(dto, ['name', 'rolle', 'status'] as const);
    const aktualisiert = await this.prisma.user.update({
      where: { id },
      data: daten as Prisma.UserUpdateInput,
      select: USER_PUBLIC,
    });
    await this.audit.write({ entitaet: 'User', entitaetId: id, aktion: 'UPDATE', userId: aktor.id, userEmail: aktor.email, vorherWert: { rolle: user.rolle, status: user.status }, nachherWert: daten });
    return aktualisiert;
  }
}
