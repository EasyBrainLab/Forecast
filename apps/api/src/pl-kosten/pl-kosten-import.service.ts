import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PlKostenExcelAdapter } from './pl-kosten-excel.adapter';

const round1 = (x: number): number => Math.round(x * 10) / 10;
const sumNonNull = (a: (number | null)[]): number => a.reduce<number>((s, v) => s + (v ?? 0), 0);

export interface PlKostenBericht {
  jahr: number;
  zeilenNeu: number;
  cogsGefunden: boolean;
  otherCostsGefunden: boolean;
  cogsActualYtd: number; // kEUR
  cogsBudgetFy: number;
  otherActualYtd: number;
  otherBudgetFy: number;
  plausibilitaet: { revenueYtd: number; ebitBerechnetYtd: number; ebitExcelYtd: number | null; abweichung: number | null } | null;
}

/** Parst „Forecast JJJJ.MM Therapy.xlsx" → Jahr. */
export function parseJahrAusDateiname(name: string): number | null {
  const m = /(\d{4})[.\-_ ]\d{2}/.exec(name) ?? /Forecast\s+(\d{4})/i.exec(name);
  return m ? Number(m[1]) : null;
}

@Injectable()
export class PlKostenImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async importiere(buffer: Buffer, dateiname: string, jahrArg: number | null, aktor: { id: string; email: string }): Promise<{ batchId: string; bericht: PlKostenBericht }> {
    const jahr = jahrArg || parseJahrAusDateiname(dateiname) || 0;
    if (!jahr || jahr < 2020 || jahr > new Date().getUTCFullYear() + 5) {
      throw new BadRequestException('Jahr nicht erkannt — bitte jahr angeben (oder Dateiname „Forecast JJJJ.MM …").');
    }
    const parsed = await new PlKostenExcelAdapter(buffer, dateiname).lese();
    const rev = parsed.zeilen.find((z) => z.kennzahlTyp === 'REVENUE');
    const cogs = parsed.zeilen.find((z) => z.kennzahlTyp === 'COGS');
    const other = parsed.zeilen.find((z) => z.kennzahlTyp === 'OTHER_COSTS');
    if (!cogs && !other) {
      throw new BadRequestException(`Keine Kostenzeilen erkannt (weder „COGS" noch „Other Costs" in Spalte B des Blatts „${parsed.sheetName}"). Bestehende Daten bleiben unverändert.`);
    }

    const batch = await this.prisma.importBatch.create({
      data: { typ: 'PL_KOSTEN', dateiname, hash: new PlKostenExcelAdapter(buffer, dateiname).meta().hash, ausgeloestVonId: aktor.id, status: 'HOCHGELADEN', zeilenGesamt: parsed.zeilen.length },
    });

    // kEUR (Excel, negativ) -> voller EUR
    const inserts: Prisma.PlKostenCreateManyInput[] = [];
    const pushZeile = (z: (typeof parsed.zeilen)[number]): void => {
      for (let m = 0; m < 12; m++) {
        if (z.actual[m] !== null) inserts.push({ jahr, monat: m + 1, art: 'ACTUAL', kennzahlTyp: z.kennzahlTyp, eur: Math.round((z.actual[m] as number) * 1000 * 100) / 100, importBatchId: batch.id });
        if (z.budget[m] !== null) inserts.push({ jahr, monat: m + 1, art: 'BUDGET', kennzahlTyp: z.kennzahlTyp, eur: Math.round((z.budget[m] as number) * 1000 * 100) / 100, importBatchId: batch.id });
      }
    };
    if (rev) pushZeile(rev);
    if (cogs) pushZeile(cogs);
    if (other) pushZeile(other);

    await this.prisma.$transaction([this.prisma.plKosten.deleteMany({ where: { jahr } }), this.prisma.plKosten.createMany({ data: inserts })]);

    // Bericht (kEUR)
    const cogsActualYtd = cogs ? round1(sumNonNull(cogs.actual)) : 0;
    const cogsBudgetFy = cogs ? round1(sumNonNull(cogs.budget)) : 0;
    const otherActualYtd = other ? round1(sumNonNull(other.actual)) : 0;
    const otherBudgetFy = other ? round1(sumNonNull(other.budget)) : 0;
    const revenueYtd = rev ? round1(sumNonNull(rev.actual)) : 0;
    const ebitExcelYtd = parsed.operatingResultActual.length ? round1(sumNonNull(parsed.operatingResultActual)) : null;
    const ebitBerechnetYtd = round1(revenueYtd + cogsActualYtd + otherActualYtd);
    const bericht: PlKostenBericht = {
      jahr,
      zeilenNeu: inserts.length,
      cogsGefunden: !!cogs,
      otherCostsGefunden: !!other,
      cogsActualYtd,
      cogsBudgetFy,
      otherActualYtd,
      otherBudgetFy,
      plausibilitaet: rev ? { revenueYtd, ebitBerechnetYtd, ebitExcelYtd, abweichung: ebitExcelYtd === null ? null : round1(ebitBerechnetYtd - ebitExcelYtd) } : null,
    };

    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: { status: 'ABGESCHLOSSEN', abgeschlossenAm: new Date(), zeilenNeu: inserts.length, validierungsbericht: bericht as unknown as Prisma.InputJsonValue },
    });
    await this.audit.write({ entitaet: 'ImportBatch', entitaetId: batch.id, aktion: 'IMPORT', userId: aktor.id, userEmail: aktor.email, metadaten: { typ: 'PL_KOSTEN', ...bericht } });
    return { batchId: batch.id, bericht };
  }
}
