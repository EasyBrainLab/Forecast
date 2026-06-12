import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../scope/scope.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';

export interface ActionItem {
  beschreibung: string;
  faelligBis: string | null;
  erledigt: boolean;
}

/** Felder, die der AGM setzen darf (Whitelist-PATCH; nie status/userId/timestamps aus dem Body). */
export interface StatementInput {
  abweichungGrund?: string;
  abweichungKommentar?: string | null;
  risiken?: string | null;
  chancen?: string | null;
  pipeline?: string | null;
  kundenGewonnen?: string | null;
  kundenVerloren?: string | null;
  preisWettbewerb?: string | null;
  forecastRealistisch?: boolean;
  forecastKommentar?: string | null;
  actionItems?: ActionItem[];
}

const GRUENDE = ['KEINE_ABWEICHUNG', 'MARKT', 'WETTBEWERB', 'PREIS', 'PROJEKTVERSCHIEBUNG', 'REGULATORISCH', 'LIEFERFAEHIGKEIT', 'EINMALEFFEKT', 'SONSTIGES'] as const;

@Injectable()
export class AgmStatementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  private parsePeriode(periode: string): { jahr: number; monat: number } {
    const m = /^(\d{4})-(\d{2})$/.exec(periode);
    if (!m) throw new BadRequestException('Periode muss Format JJJJ-MM haben.');
    return { jahr: Number(m[1]), monat: Number(m[2]) };
  }

  private sanitizeActionItems(items: unknown): ActionItem[] {
    if (!Array.isArray(items)) return [];
    return items
      .map((it) => {
        const o = it as Record<string, unknown>;
        const beschreibung = String(o.beschreibung ?? '').trim();
        if (!beschreibung) return null;
        const faellig = o.faelligBis ? String(o.faelligBis).slice(0, 10) : null;
        return { beschreibung: beschreibung.slice(0, 1000), faelligBis: faellig, erledigt: Boolean(o.erledigt) };
      })
      .filter((x): x is ActionItem => x !== null)
      .slice(0, 50);
  }

  /** Sichtbare Regionen: AGM -> eigene, alle anderen -> alle forecast-relevanten. */
  private async sichtbareRegionen(aktor: RequestUser): Promise<{ code: string; bezeichnung: string }[]> {
    if (aktor.rolle === 'AGM') {
      const s = await this.scope.getScope(aktor);
      if (s.regionCodes.length === 0) return [];
      return this.prisma.region.findMany({ where: { code: { in: s.regionCodes } }, select: { code: true, bezeichnung: true }, orderBy: { code: 'asc' } });
    }
    return this.prisma.region.findMany({ where: { forecastRelevant: true }, select: { code: true, bezeichnung: true }, orderBy: { code: 'asc' } });
  }

  /** Statements einer Periode für die sichtbaren Regionen (existierend oder Skelett). */
  async fuerPeriode(periode: string, aktor: RequestUser) {
    this.parsePeriode(periode);
    const regionen = await this.sichtbareRegionen(aktor);
    const codes = regionen.map((r) => r.code);
    const vorhandene = await this.prisma.agmStatement.findMany({ where: { periode, regionCode: { in: codes.length ? codes : ['__none__'] } } });
    const byRegion = new Map(vorhandene.map((s) => [s.regionCode, s]));
    return {
      periode,
      bearbeitbar: aktor.rolle === 'AGM',
      regionen: regionen.map((r) => {
        const s = byRegion.get(r.code);
        return {
          regionCode: r.code,
          bezeichnung: r.bezeichnung,
          status: s?.status ?? 'OFFEN',
          statement: s ? this.toDto(s) : null,
        };
      }),
    };
  }

  private toDto(s: Prisma.AgmStatementGetPayload<object>) {
    return {
      id: s.id,
      periode: s.periode,
      regionCode: s.regionCode,
      userName: s.userName,
      abweichungGrund: s.abweichungGrund,
      abweichungKommentar: s.abweichungKommentar,
      risiken: s.risiken,
      chancen: s.chancen,
      pipeline: s.pipeline,
      kundenGewonnen: s.kundenGewonnen,
      kundenVerloren: s.kundenVerloren,
      preisWettbewerb: s.preisWettbewerb,
      forecastRealistisch: s.forecastRealistisch,
      forecastKommentar: s.forecastKommentar,
      actionItems: (s.actionItems as unknown as ActionItem[]) ?? [],
      status: s.status,
      eingereichtAm: s.eingereichtAm,
      aktualisiertAm: s.aktualisiertAm,
    };
  }

  private cleanGrund(g?: string): 'KEINE_ABWEICHUNG' | 'MARKT' | 'WETTBEWERB' | 'PREIS' | 'PROJEKTVERSCHIEBUNG' | 'REGULATORISCH' | 'LIEFERFAEHIGKEIT' | 'EINMALEFFEKT' | 'SONSTIGES' {
    return (GRUENDE as readonly string[]).includes(g ?? '') ? (g as (typeof GRUENDE)[number]) : 'KEINE_ABWEICHUNG';
  }

  /** Entwurf speichern (nur AGM, eigene Region; gesperrt sobald EINGEREICHT). */
  async speichern(periode: string, regionCode: string, input: StatementInput, aktor: RequestUser) {
    if (aktor.rolle !== 'AGM') throw new ForbiddenException('Nur AGM können Statements erfassen.');
    const { jahr, monat } = this.parsePeriode(periode);
    const s = await this.scope.getScope(aktor);
    this.scope.assertSchreibScope(s, regionCode);

    const vorhanden = await this.prisma.agmStatement.findUnique({ where: { periode_regionCode: { periode, regionCode } } });
    if (vorhanden && vorhanden.status === 'EINGEREICHT') throw new ForbiddenException('Statement ist bereits eingereicht und gesperrt.');

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: aktor.id }, select: { name: true } });
    const data = {
      abweichungGrund: this.cleanGrund(input.abweichungGrund),
      abweichungKommentar: input.abweichungKommentar ?? null,
      risiken: input.risiken ?? null,
      chancen: input.chancen ?? null,
      pipeline: input.pipeline ?? null,
      kundenGewonnen: input.kundenGewonnen ?? null,
      kundenVerloren: input.kundenVerloren ?? null,
      preisWettbewerb: input.preisWettbewerb ?? null,
      forecastRealistisch: input.forecastRealistisch ?? true,
      forecastKommentar: input.forecastKommentar ?? null,
      actionItems: this.sanitizeActionItems(input.actionItems) as unknown as Prisma.InputJsonValue,
    };
    const result = await this.prisma.agmStatement.upsert({
      where: { periode_regionCode: { periode, regionCode } },
      update: data,
      create: { periode, jahr, monat, regionCode, userId: aktor.id, userName: user.name, status: 'ENTWURF', ...data },
    });
    await this.audit.write({ entitaet: 'AgmStatement', entitaetId: result.id, aktion: vorhanden ? 'UPDATE' : 'CREATE', userId: aktor.id, userEmail: aktor.email, metadaten: { periode, regionCode } });
    return this.toDto(result);
  }

  /** Einreichen: Pflichtfelder prüfen, Status sperren. */
  async einreichen(periode: string, regionCode: string, aktor: RequestUser) {
    if (aktor.rolle !== 'AGM') throw new ForbiddenException('Nur AGM können Statements einreichen.');
    const s = await this.scope.getScope(aktor);
    this.scope.assertSchreibScope(s, regionCode);
    const vorhanden = await this.prisma.agmStatement.findUnique({ where: { periode_regionCode: { periode, regionCode } } });
    if (!vorhanden) throw new NotFoundException('Kein Statement-Entwurf vorhanden.');
    if (vorhanden.status === 'EINGEREICHT') throw new ForbiddenException('Bereits eingereicht.');
    if (vorhanden.abweichungGrund !== 'KEINE_ABWEICHUNG' && !vorhanden.abweichungKommentar?.trim()) {
      throw new BadRequestException('Bei einer Abweichung ist ein Kommentar zum Grund Pflicht.');
    }
    if (!vorhanden.forecastRealistisch && !vorhanden.forecastKommentar?.trim()) {
      throw new BadRequestException('Wenn der Forecast als nicht realistisch markiert ist, ist ein Kommentar Pflicht.');
    }
    const result = await this.prisma.agmStatement.update({ where: { id: vorhanden.id }, data: { status: 'EINGEREICHT', eingereichtAm: new Date() } });
    await this.audit.write({ entitaet: 'AgmStatement', entitaetId: result.id, aktion: 'STATUS_WECHSEL', userId: aktor.id, userEmail: aktor.email, nachherWert: { status: 'EINGEREICHT' } });
    return this.toDto(result);
  }

  /** Wieder öffnen (eigener AGM oder ADMIN), z.B. bei Korrekturbedarf. */
  async zuruecksetzen(periode: string, regionCode: string, aktor: RequestUser) {
    const vorhanden = await this.prisma.agmStatement.findUnique({ where: { periode_regionCode: { periode, regionCode } } });
    if (!vorhanden) throw new NotFoundException('Kein Statement vorhanden.');
    if (aktor.rolle === 'AGM') {
      const s = await this.scope.getScope(aktor);
      this.scope.assertSchreibScope(s, regionCode);
    } else if (aktor.rolle !== 'ADMIN') {
      throw new ForbiddenException('Nur AGM (eigene Region) oder Admin.');
    }
    const result = await this.prisma.agmStatement.update({ where: { id: vorhanden.id }, data: { status: 'ENTWURF', eingereichtAm: null } });
    await this.audit.write({ entitaet: 'AgmStatement', entitaetId: result.id, aktion: 'STATUS_WECHSEL', userId: aktor.id, userEmail: aktor.email, nachherWert: { status: 'ENTWURF' } });
    return this.toDto(result);
  }

  /** Offene Action-Items über die sichtbaren Regionen (für BU/VL-Board). */
  async offeneActionItems(aktor: RequestUser) {
    const regionen = await this.sichtbareRegionen(aktor);
    const codes = regionen.map((r) => r.code);
    const regBez = new Map(regionen.map((r) => [r.code, r.bezeichnung]));
    const statements = await this.prisma.agmStatement.findMany({ where: { regionCode: { in: codes.length ? codes : ['__none__'] } }, orderBy: [{ periode: 'desc' }] });
    const offen: { periode: string; regionCode: string; region: string; beschreibung: string; faelligBis: string | null }[] = [];
    for (const s of statements) {
      for (const it of (s.actionItems as unknown as ActionItem[]) ?? []) {
        if (!it.erledigt) offen.push({ periode: s.periode, regionCode: s.regionCode, region: regBez.get(s.regionCode) ?? s.regionCode, beschreibung: it.beschreibung, faelligBis: it.faelligBis });
      }
    }
    return offen;
  }
}
