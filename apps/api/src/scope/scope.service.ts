import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EINSTELLUNG_KEYS, type Rolle } from '@forecast/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { Scope } from './scope.types';

@Injectable()
export class ScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /** Ermittelt den Zugriffsscope live aus der DB (kein Scope im JWT). */
  async getScope(user: { id: string; rolle: Rolle }): Promise<Scope> {
    if (user.rolle !== 'AGM') {
      return { rolle: user.rolle, unbeschraenkt: true, crossSicht: false, regionCodes: [], kostenstelleIds: [] };
    }
    const heute = new Date();
    const verantwortungen = await this.prisma.regionsVerantwortung.findMany({
      where: {
        userId: user.id,
        geloeschtAm: null,
        gueltigVon: { lte: heute },
        OR: [{ gueltigBis: null }, { gueltigBis: { gte: heute } }],
      },
      select: { regionCode: true },
    });
    const regionCodes = [...new Set(verantwortungen.map((v) => v.regionCode))];
    const ksts = regionCodes.length
      ? await this.prisma.kostenstelle.findMany({ where: { regionCode: { in: regionCodes } }, select: { id: true } })
      : [];
    const cross =
      (await this.prisma.einstellung.findUnique({ where: { key: EINSTELLUNG_KEYS.AGM_CROSS_SICHT } }))?.value ===
      'true';
    return {
      rolle: 'AGM',
      unbeschraenkt: cross,
      crossSicht: cross,
      regionCodes,
      kostenstelleIds: ksts.map((k) => k.id),
    };
  }

  /** Read-Filter für IstUmsatz (fail-closed: leerer AGM-Scope -> 403). */
  istUmsatzWhere(scope: Scope): Prisma.IstUmsatzWhereInput {
    if (scope.unbeschraenkt) return {};
    if (scope.kostenstelleIds.length === 0) throw new ForbiddenException('Kein Zugriffsscope.');
    return { kostenstelleId: { in: scope.kostenstelleIds } };
  }

  /** Read-Filter für region-getragene Modelle (Budget/Forecast/BudgetAenderung). */
  regionWhere(scope: Scope): { regionCode?: { in: string[] } } {
    if (scope.unbeschraenkt) return {};
    if (scope.regionCodes.length === 0) throw new ForbiddenException('Kein Zugriffsscope.');
    return { regionCode: { in: scope.regionCodes } };
  }

  /** Schreibschutz: AGM darf nur in eigene Region schreiben (Cross-Sicht erweitert NUR Lesen). */
  assertSchreibScope(scope: Scope, regionCode: string): void {
    if (scope.rolle !== 'AGM') return;
    if (!scope.regionCodes.includes(regionCode)) {
      throw new ForbiddenException('Schreibzugriff nur in der eigenen Region.');
    }
  }
}
