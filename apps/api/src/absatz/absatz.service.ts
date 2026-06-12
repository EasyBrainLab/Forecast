import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const r = (x: unknown): number => Math.round(Number(x ?? 0));

@Injectable()
export class AbsatzService {
  constructor(private readonly prisma: PrismaService) {}

  async perioden() {
    const grp = await this.prisma.absatz.groupBy({ by: ['jahr', 'bisMonat'], _count: { _all: true }, orderBy: [{ jahr: 'desc' }, { bisMonat: 'desc' }] });
    return grp.map((g) => ({ jahr: g.jahr, bisMonat: g.bisMonat, zeilen: g._count._all }));
  }

  async kpi(jahr: number, bisMonat: number) {
    const where = { jahr, bisMonat };
    const [agg, landGrp, kundeGrp, laender] = await Promise.all([
      this.prisma.absatz.aggregate({ where, _sum: { seeds: true, seedsVorjahr: true, ruthen: true, ruthenVorjahr: true, icTotal: true, isTotal: true, s16: true, s16Vorjahr: true } }),
      this.prisma.absatz.groupBy({ by: ['landId'], where, _sum: { seeds: true, seedsVorjahr: true } }),
      this.prisma.absatz.groupBy({ by: ['kunde'], where, _sum: { seeds: true, seedsVorjahr: true } }),
      this.prisma.land.findMany({ select: { isoCode: true, nameDe: true } }),
    ]);
    const landName = new Map(laender.map((l) => [l.isoCode, l.nameDe]));
    const s = agg._sum;
    const yoy = (ist: number, py: number): number | null => (py === 0 ? null : Math.round(((ist - py) / Math.abs(py)) * 1000) / 10);
    return {
      jahr,
      bisMonat,
      kennzahlen: {
        seeds: r(s.seeds),
        seedsVorjahr: r(s.seedsVorjahr),
        seedsYoY: yoy(r(s.seeds), r(s.seedsVorjahr)),
        ruthen: r(s.ruthen),
        ruthenVorjahr: r(s.ruthenVorjahr),
      },
      seedsProLand: landGrp
        .map((g) => ({ land: landName.get(g.landId) ?? g.landId, seeds: r(g._sum.seeds), vorjahr: r(g._sum.seedsVorjahr) }))
        .filter((x) => x.seeds !== 0 || x.vorjahr !== 0)
        .sort((a, b) => b.seeds - a.seeds),
      topKunden: kundeGrp
        .map((g) => ({ kunde: g.kunde, seeds: r(g._sum.seeds), vorjahr: r(g._sum.seedsVorjahr) }))
        .sort((a, b) => b.seeds - a.seeds)
        .slice(0, 15),
      produkte: [
        { name: 'Seeds gesamt', menge: r(s.seeds), vorjahr: r(s.seedsVorjahr) },
        { name: 'IC (S06/S17)', menge: r(s.icTotal), vorjahr: 0 },
        { name: 'IS (S06/S17)', menge: r(s.isTotal), vorjahr: 0 },
        { name: 'Ruthenium', menge: r(s.ruthen), vorjahr: r(s.ruthenVorjahr) },
        { name: 'S16', menge: r(s.s16), vorjahr: r(s.s16Vorjahr) },
      ],
    };
  }

  async daten(jahr: number, bisMonat: number, page = 1, pageSize = 50, landId?: string) {
    const ps = Math.min(Math.max(pageSize, 1), 200);
    const where = { jahr, bisMonat, ...(landId ? { landId } : {}) };
    const [total, items, laender] = await Promise.all([
      this.prisma.absatz.count({ where }),
      this.prisma.absatz.findMany({ where, orderBy: { seeds: 'desc' }, skip: (page - 1) * ps, take: ps }),
      this.prisma.land.findMany({ select: { isoCode: true, nameDe: true } }),
    ]);
    const landName = new Map(laender.map((l) => [l.isoCode, l.nameDe]));
    return {
      page,
      pageSize: ps,
      total,
      items: items.map((a) => ({
        id: a.id,
        land: landName.get(a.landId) ?? a.landId,
        kunde: a.kunde,
        stadt: a.stadt,
        seeds: r(a.seeds),
        seedsVorjahr: r(a.seedsVorjahr),
        ruthen: r(a.ruthen),
        s16: r(a.s16),
      })),
    };
  }
}
