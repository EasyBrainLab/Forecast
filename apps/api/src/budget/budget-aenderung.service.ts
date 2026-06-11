import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BudgetAenderungStatus, Prisma } from '@prisma/client';
import { BUDGET_TRANSITIONS } from '@forecast/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { infoMail } from '../mail/mail.templates';
import { ScopeService } from '../scope/scope.service';
import { StateMachineService } from '../workflow/state-machine.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { CreateBudgetAenderungDto, EntscheidungDto } from './budget-aenderung.dto';

@Injectable()
export class BudgetAenderungService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly scope: ScopeService,
    private readonly sm: StateMachineService,
  ) {}

  async list(aktor: RequestUser) {
    const scope = await this.scope.getScope(aktor);
    const where = scope.unbeschraenkt ? {} : { regionCode: { in: scope.regionCodes.length ? scope.regionCodes : ['__none__'] } };
    return this.prisma.budgetAenderung.findMany({ where, orderBy: { erstelltAm: 'desc' }, include: { events: true } });
  }

  async create(dto: CreateBudgetAenderungDto, aktor: RequestUser) {
    const scope = await this.scope.getScope(aktor);
    this.scope.assertSchreibScope(scope, dto.regionCode);

    let altWertEur: number | null = null;
    let altUnits: number | null = null;
    if (dto.budgetId) {
      const alt = await this.prisma.budget.findUnique({ where: { id: dto.budgetId } });
      if (!alt || alt.status !== 'AKTIV') throw new BadRequestException('Budget-Position nicht gefunden/aktiv.');
      altWertEur = alt.wertEur === null ? null : Number(alt.wertEur);
      altUnits = alt.units === null ? null : Number(alt.units);
    }

    const aenderung = await this.prisma.$transaction(async (tx) => {
      const a = await tx.budgetAenderung.create({
        data: {
          budgetId: dto.budgetId ?? null,
          antragstellerId: aktor.id,
          jahr: dto.jahr,
          regionCode: dto.regionCode,
          landId: dto.landId ?? null,
          e1Id: dto.e1Id,
          altWertEur,
          neuWertEur: dto.neuWertEur,
          altUnits,
          neuUnits: dto.neuUnits ?? null,
          begruendung: dto.begruendung,
          status: BudgetAenderungStatus.ENTWURF,
        },
      });
      await tx.budgetAenderungEvent.create({ data: { aenderungId: a.id, vonStatus: null, nachStatus: BudgetAenderungStatus.ENTWURF, byUserId: aktor.id } });
      await this.audit.write({ entitaet: 'BudgetAenderung', entitaetId: a.id, aktion: 'CREATE', userId: aktor.id, userEmail: aktor.email }, tx);
      return a;
    });
    return aenderung;
  }

  private async ladeMitScope(id: string, aktor: RequestUser) {
    const a = await this.prisma.budgetAenderung.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Antrag nicht gefunden.');
    if (aktor.rolle === 'AGM') {
      const scope = await this.scope.getScope(aktor);
      if (!scope.regionCodes.includes(a.regionCode)) throw new ForbiddenException('Kein Zugriff auf diese Region.');
    }
    return a;
  }

  private async transition(id: string, ziel: BudgetAenderungStatus, aktor: RequestUser, begruendung?: string | null) {
    const a = await this.ladeMitScope(id, aktor);
    const def = this.sm.pruefe(BUDGET_TRANSITIONS, a.status, ziel, {
      rolle: aktor.rolle,
      aktorId: aktor.id,
      antragstellerId: a.antragstellerId,
      begruendung,
    });
    return { a, def };
  }

  async beantragen(id: string, aktor: RequestUser) {
    const { a } = await this.transition(id, BudgetAenderungStatus.BEANTRAGT, aktor);
    if (a.antragstellerId !== aktor.id) throw new ForbiddenException('Nur der Antragsteller kann beantragen.');
    await this.eventUndStatus(a.id, a.status, BudgetAenderungStatus.BEANTRAGT, aktor);
    await this.mailAnRolle('VERTRIEBSLEITER', infoMail('Budgetänderung beantragt', 'Neue Budgetänderung', `Region ${a.regionCode}, Jahr ${a.jahr}: bitte prüfen.`));
    return { status: BudgetAenderungStatus.BEANTRAGT };
  }

  async freigabeVl(id: string, aktor: RequestUser) {
    const { a } = await this.transition(id, BudgetAenderungStatus.FREIGABE_VERTRIEBSLEITER, aktor);
    await this.eventUndStatus(a.id, a.status, BudgetAenderungStatus.FREIGABE_VERTRIEBSLEITER, aktor);
    await this.mailAnRolle('BU_LEITER', infoMail('Budgetänderung Stufe 1 freigegeben', 'Freigabe Stufe 1', `Region ${a.regionCode}: finale Freigabe erforderlich.`));
    return { status: BudgetAenderungStatus.FREIGABE_VERTRIEBSLEITER };
  }

  async freigabeBu(id: string, aktor: RequestUser) {
    const a = await this.ladeMitScope(id, aktor);
    // B5 (FREIGABE_VL -> FREIGABE_BU) + B7 (FREIGABE_BU -> AKTIV), atomar.
    this.sm.pruefe(BUDGET_TRANSITIONS, a.status, BudgetAenderungStatus.FREIGABE_BU_LEITER, { rolle: aktor.rolle, aktorId: aktor.id, antragstellerId: a.antragstellerId });
    await this.prisma.$transaction(async (tx) => {
      await tx.budgetAenderungEvent.create({ data: { aenderungId: a.id, vonStatus: a.status, nachStatus: BudgetAenderungStatus.FREIGABE_BU_LEITER, byUserId: aktor.id } });
      await tx.budgetAenderungEvent.create({ data: { aenderungId: a.id, vonStatus: BudgetAenderungStatus.FREIGABE_BU_LEITER, nachStatus: BudgetAenderungStatus.AKTIV, byUserId: aktor.id } });
      await tx.budgetAenderung.update({ where: { id: a.id }, data: { status: BudgetAenderungStatus.AKTIV } });
      await this.wendeBudgetAenderungAn(a, aktor, tx);
      await this.audit.write({ entitaet: 'BudgetAenderung', entitaetId: a.id, aktion: 'STATUS_WECHSEL', userId: aktor.id, userEmail: aktor.email, nachherWert: { status: 'AKTIV' } }, tx);
    });
    await this.mailAnUser(a.antragstellerId, infoMail('Budgetänderung freigegeben', 'Antrag genehmigt', `Ihre Budgetänderung (Region ${a.regionCode}, Jahr ${a.jahr}) wurde final freigegeben.`));
    return { status: BudgetAenderungStatus.AKTIV };
  }

  async ablehnen(id: string, aktor: RequestUser, dto: EntscheidungDto) {
    const a = await this.ladeMitScope(id, aktor);
    this.sm.pruefe(BUDGET_TRANSITIONS, a.status, BudgetAenderungStatus.ABGELEHNT, { rolle: aktor.rolle, aktorId: aktor.id, antragstellerId: a.antragstellerId, begruendung: dto.begruendung });
    await this.eventUndStatus(a.id, a.status, BudgetAenderungStatus.ABGELEHNT, aktor, dto.begruendung);
    await this.mailAnUser(a.antragstellerId, infoMail('Budgetänderung abgelehnt', 'Antrag abgelehnt', `Begründung: ${dto.begruendung ?? '-'}`));
    return { status: BudgetAenderungStatus.ABGELEHNT };
  }

  private async eventUndStatus(id: string, von: BudgetAenderungStatus, nach: BudgetAenderungStatus, aktor: RequestUser, begruendung?: string | null) {
    await this.prisma.$transaction(async (tx) => {
      await tx.budgetAenderungEvent.create({ data: { aenderungId: id, vonStatus: von, nachStatus: nach, byUserId: aktor.id, begruendung: begruendung ?? null } });
      await tx.budgetAenderung.update({ where: { id }, data: { status: nach } });
      await this.audit.write({ entitaet: 'BudgetAenderung', entitaetId: id, aktion: 'STATUS_WECHSEL', userId: aktor.id, userEmail: aktor.email, vorherWert: { status: von }, nachherWert: { status: nach } }, tx);
    });
  }

  /** Wendet die genehmigte Änderung auf das Budget an: alte Version historisieren, neue AKTIV. */
  private async wendeBudgetAenderungAn(
    a: { id: string; budgetId: string | null; jahr: number; regionCode: string; landId: string | null; e1Id: string; neuWertEur: Prisma.Decimal; neuUnits: Prisma.Decimal | null },
    aktor: RequestUser,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    if (a.budgetId) {
      const alt = await tx.budget.findUniqueOrThrow({ where: { id: a.budgetId } });
      await tx.budget.update({ where: { id: a.budgetId }, data: { status: 'HISTORISIERT' } });
      await tx.budget.create({
        data: {
          jahr: alt.jahr,
          monat: alt.monat,
          regionCode: alt.regionCode,
          landId: alt.landId,
          e1Id: alt.e1Id,
          e2Id: alt.e2Id,
          company: alt.company,
          kostentraeger: alt.kostentraeger,
          wertEur: a.neuWertEur,
          units: a.neuUnits,
          asp: alt.asp,
          istRegionsreserve: alt.istRegionsreserve,
          version: alt.version + 1,
          status: 'AKTIV',
        },
      });
      await this.audit.write({ entitaet: 'Budget', entitaetId: a.budgetId, aktion: 'UPDATE', userId: aktor.id, userEmail: aktor.email, vorherWert: { wertEur: Number(alt.wertEur) }, nachherWert: { wertEur: Number(a.neuWertEur) } }, tx);
    } else {
      await tx.budget.create({
        data: { jahr: a.jahr, monat: null, regionCode: a.regionCode, landId: a.landId, e1Id: a.e1Id, company: 'BBD', wertEur: a.neuWertEur, units: a.neuUnits, version: 1, status: 'AKTIV' },
      });
    }
  }

  private async mailAnRolle(rolle: 'VERTRIEBSLEITER' | 'BU_LEITER', inhalt: Parameters<MailService['send']>[1]): Promise<void> {
    const empfaenger = await this.prisma.user.findMany({ where: { rolle, status: 'VERIFIZIERT' }, select: { email: true } });
    await Promise.all(empfaenger.map((e) => this.mail.send(e.email, inhalt)));
  }

  private async mailAnUser(userId: string, inhalt: Parameters<MailService['send']>[1]): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (user) await this.mail.send(user.email, inhalt);
  }
}
