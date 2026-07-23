import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Reihenfolge, in der die Import-Arten in der Datenstand-Übersicht erscheinen. */
const TYP_REIHENFOLGE = ['IST', 'BUDGET', 'ABSATZ', 'LIEFERMENGE', 'PL_KOSTEN', 'KUNDENSTAMM', 'RECHNUNG', 'RECHNUNGSPOSITION'] as const;

@Injectable()
export class ImportUebersichtService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liefert je Import-Art den jeweils letzten Import (Dateiname, Zeitpunkt, Status, Kennzahlen +
   * vollständiger Validierungsbericht). Damit ist dauerhaft nachvollziehbar, mit welchem Datenstand
   * das Tool aktuell arbeitet.
   */
  async letzteImporte() {
    const batches = await this.prisma.importBatch.findMany({
      orderBy: { erstelltAm: 'desc' },
      distinct: ['typ'],
      select: {
        typ: true,
        dateiname: true,
        status: true,
        erstelltAm: true,
        abgeschlossenAm: true,
        zeilenGesamt: true,
        zeilenNeu: true,
        zeilenAktualisiert: true,
        zeilenUebersprungen: true,
        zeilenQuarantaene: true,
        validierungsbericht: true,
      },
    });
    const nach = new Map(batches.map((b) => [b.typ, b]));
    // Bekannte Arten in fester Reihenfolge, gefolgt von etwaigen unbekannten Typen.
    const bekannt = TYP_REIHENFOLGE.filter((t) => nach.has(t));
    const weitere = batches.map((b) => b.typ).filter((t) => !TYP_REIHENFOLGE.includes(t as (typeof TYP_REIHENFOLGE)[number]));
    return [...bekannt, ...weitere].map((typ) => {
      const b = nach.get(typ)!;
      return {
        typ: b.typ,
        dateiname: b.dateiname,
        status: b.status,
        erstelltAm: b.erstelltAm,
        abgeschlossenAm: b.abgeschlossenAm,
        zeilenGesamt: b.zeilenGesamt,
        zeilenNeu: b.zeilenNeu,
        zeilenAktualisiert: b.zeilenAktualisiert,
        zeilenUebersprungen: b.zeilenUebersprungen,
        zeilenQuarantaene: b.zeilenQuarantaene,
        bericht: b.validierungsbericht,
      };
    });
  }
}
