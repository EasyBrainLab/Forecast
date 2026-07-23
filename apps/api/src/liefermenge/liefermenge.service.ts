import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const round2 = (x: number): number => Math.round(x * 100) / 100;

@Injectable()
export class LiefermengeService {
  constructor(private readonly prisma: PrismaService) {}

  /** AGM-Region-Filter (null = unbeschränkt). Unmapped Kunden (regionCode null) sind für AGM nicht sichtbar. */
  private rf(regionCodes: string[] | null): Prisma.LiefermengeWhereInput {
    if (regionCodes === null) return {};
    return { regionCode: { in: regionCodes.length ? regionCodes : ['__none__'] } };
  }

  async perioden(regionCodes: string[] | null): Promise<{ jahr: number; monat: number }[]> {
    const grp = await this.prisma.liefermenge.groupBy({ by: ['jahr', 'monat'], where: this.rf(regionCodes) });
    return grp.map((g) => ({ jahr: g.jahr, monat: g.monat })).sort((a, b) => b.jahr - a.jahr || b.monat - a.monat);
  }

  async kpi(jahr: number, bisMonat: number, regionCodes: string[] | null) {
    const where: Prisma.LiefermengeWhereInput = { jahr, monat: { lte: bisMonat }, ...this.rf(regionCodes) };
    const [summe, jeE1Grp, jeMonatGrp, jeLandGrp, jeRegionGrp, e1s, laender] = await Promise.all([
      this.prisma.liefermenge.aggregate({ where, _sum: { stueckzahl: true, seedzahl: true, lineAmountEur: true }, _count: { _all: true } }),
      this.prisma.liefermenge.groupBy({ by: ['e1Id'], where, _sum: { stueckzahl: true, seedzahl: true } }),
      this.prisma.liefermenge.groupBy({ by: ['monat'], where, _sum: { stueckzahl: true, seedzahl: true } }),
      this.prisma.liefermenge.groupBy({ by: ['landId'], where, _sum: { stueckzahl: true, seedzahl: true } }),
      this.prisma.liefermenge.groupBy({ by: ['regionCode'], where, _sum: { stueckzahl: true, seedzahl: true } }),
      this.prisma.produktgruppeE1.findMany({ select: { id: true, nameDe: true } }),
      this.prisma.land.findMany({ select: { isoCode: true, nameDe: true } }),
    ]);
    const e1Name = new Map(e1s.map((e) => [e.id, e.nameDe]));
    const landName = new Map(laender.map((l) => [l.isoCode, l.nameDe]));
    const n = (v: Prisma.Decimal | null): number => round2(Number(v ?? 0));

    return {
      jahr,
      bisMonat,
      zeilen: summe._count._all,
      stueckGesamt: n(summe._sum.stueckzahl),
      seedGesamt: n(summe._sum.seedzahl),
      lineAmountGesamt: n(summe._sum.lineAmountEur),
      jeProdukt: jeE1Grp.map((g) => ({ produktgruppe: e1Name.get(g.e1Id) ?? g.e1Id, stueck: n(g._sum.stueckzahl), seed: n(g._sum.seedzahl) })).sort((a, b) => b.seed - a.seed),
      jeMonat: jeMonatGrp.map((g) => ({ monat: g.monat, stueck: n(g._sum.stueckzahl), seed: n(g._sum.seedzahl) })).sort((a, b) => a.monat - b.monat),
      jeLand: jeLandGrp
        .map((g) => ({ land: g.landId ? (landName.get(g.landId) ?? g.landId) : '—', stueck: n(g._sum.stueckzahl), seed: n(g._sum.seedzahl) }))
        .sort((a, b) => b.seed - a.seed)
        .slice(0, 15),
      jeRegion: jeRegionGrp.map((g) => ({ regionCode: g.regionCode ?? '—', stueck: n(g._sum.stueckzahl), seed: n(g._sum.seedzahl) })).sort((a, b) => b.seed - a.seed),
    };
  }

  async daten(jahr: number, filter: { regionCode?: string; e1Id?: string; monat?: number }, page: number, pageSize: number, regionCodes: string[] | null) {
    const ps = Math.min(Math.max(pageSize, 1), 20000);
    const where: Prisma.LiefermengeWhereInput = { jahr, ...this.rf(regionCodes) };
    if (filter.regionCode) where.regionCode = filter.regionCode;
    if (filter.e1Id) where.e1Id = filter.e1Id;
    if (filter.monat) where.monat = filter.monat;

    const [total, sum, items] = await Promise.all([
      this.prisma.liefermenge.count({ where }),
      this.prisma.liefermenge.aggregate({ where, _sum: { stueckzahl: true, seedzahl: true } }),
      this.prisma.liefermenge.findMany({
        where,
        orderBy: { shippingDate: 'desc' },
        skip: (page - 1) * ps,
        take: ps,
        include: { land: { select: { nameDe: true } }, e1: { select: { nameDe: true } }, e2: { select: { name: true } } },
      }),
    ]);
    return {
      page,
      pageSize: ps,
      total,
      stueckSumme: round2(Number(sum._sum.stueckzahl ?? 0)),
      seedSumme: round2(Number(sum._sum.seedzahl ?? 0)),
      items: items.map((i) => ({
        id: i.id,
        shippingDate: i.shippingDate,
        monat: i.monat,
        auftragsnummer: i.auftragsnummer,
        kunde: i.kunde,
        land: i.land?.nameDe ?? '—',
        regionCode: i.regionCode ?? '—',
        produktgruppe: i.e1.nameDe,
        e2: i.e2?.name ?? '—',
        itemNumber: i.itemNumber,
        stueckzahl: round2(Number(i.stueckzahl)),
        seedzahl: round2(Number(i.seedzahl)),
        orderedQty: i.orderedQty === null ? null : round2(Number(i.orderedQty)),
        lineAmountEur: i.lineAmountEur === null ? null : round2(Number(i.lineAmountEur)),
        kostenstelle: i.kostenstelleRoh ?? '—',
        kostentraeger: i.kostentraeger ?? '—',
      })),
    };
  }
}
