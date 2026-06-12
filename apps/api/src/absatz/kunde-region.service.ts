import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';

const r = (x: unknown): number => Math.round(Number(x ?? 0));

@Injectable()
export class KundeRegionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Alle Zuordnungen + Anzahl der dadurch zugeordneten Absatz-Zeilen. */
  async list() {
    const [mappings, regionen] = await Promise.all([
      this.prisma.kundeRegion.findMany({ orderBy: { kunde: 'asc' } }),
      this.prisma.region.findMany({ select: { code: true, bezeichnung: true } }),
    ]);
    const regBez = new Map(regionen.map((x) => [x.code, x.bezeichnung]));
    return mappings.map((m) => ({ id: m.id, kunde: m.kunde, regionCode: m.regionCode, region: regBez.get(m.regionCode) ?? m.regionCode }));
  }

  /** Noch nicht zugeordnete Kunden (regionCode null) der jüngsten Periode — als Vorschlagsliste mit Seeds/Land. */
  async unmapped() {
    const letzte = await this.prisma.absatz.findFirst({ orderBy: [{ jahr: 'desc' }, { bisMonat: 'desc' }], select: { jahr: true, bisMonat: true } });
    if (!letzte) return { jahr: null, bisMonat: null, kunden: [] };
    const grp = await this.prisma.absatz.groupBy({
      by: ['kunde'],
      where: { jahr: letzte.jahr, bisMonat: letzte.bisMonat, regionCode: null },
      _sum: { seeds: true },
      orderBy: { _sum: { seeds: 'desc' } },
    });
    return { jahr: letzte.jahr, bisMonat: letzte.bisMonat, kunden: grp.map((g) => ({ kunde: g.kunde, seeds: r(g._sum.seeds) })) };
  }

  /** Zuordnung setzen/ändern; wirkt rückwirkend auf bereits importierte Absatz-Zeilen desselben Kunden. */
  async upsert(kunde: string, regionCode: string, aktor: RequestUser) {
    const k = kunde.trim();
    if (!k) throw new BadRequestException('Kunde fehlt.');
    const region = await this.prisma.region.findUnique({ where: { code: regionCode } });
    if (!region) throw new BadRequestException(`Unbekannte Region: ${regionCode}`);
    const mapping = await this.prisma.kundeRegion.upsert({
      where: { kunde: k },
      update: { regionCode },
      create: { kunde: k, regionCode },
    });
    const { count } = await this.prisma.absatz.updateMany({ where: { kunde: k }, data: { regionCode } });
    await this.audit.write({ entitaet: 'KundeRegion', entitaetId: mapping.id, aktion: 'UPDATE', userId: aktor.id, userEmail: aktor.email, nachherWert: { kunde: k, regionCode, zeilenAktualisiert: count } });
    return { kunde: k, regionCode, zeilenAktualisiert: count };
  }

  /** Stapel-Zuordnung (mehrere Kunden auf einmal). */
  async bulkUpsert(items: { kunde: string; regionCode: string }[], aktor: RequestUser) {
    let zeilen = 0;
    for (const it of items) {
      const res = await this.upsert(it.kunde, it.regionCode, aktor);
      zeilen += res.zeilenAktualisiert;
    }
    return { zugeordnet: items.length, zeilenAktualisiert: zeilen };
  }

  async remove(kunde: string, aktor: RequestUser) {
    const k = kunde.trim();
    await this.prisma.kundeRegion.deleteMany({ where: { kunde: k } });
    const { count } = await this.prisma.absatz.updateMany({ where: { kunde: k }, data: { regionCode: null } });
    await this.audit.write({ entitaet: 'KundeRegion', entitaetId: k, aktion: 'DELETE', userId: aktor.id, userEmail: aktor.email, metadaten: { kunde: k, zeilenZurueckgesetzt: count } });
    return { kunde: k, zeilenZurueckgesetzt: count };
  }
}
