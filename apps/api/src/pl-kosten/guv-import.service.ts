import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { GuvExcelAdapter, GUV_POSITIONEN } from './guv-excel.adapter';

const k1 = (x: number): number => Math.round(x * 10) / 10;

export interface GuvBericht {
  jahr: number;
  stichtagMonat: number;
  positionen: number;
  fehlend: string[];
  revenueIst: number; // kEUR
  operatingResultIst: number;
  ebitIst: number;
  operatingResultPy: number;
  operatingResultBud: number;
}

/** „GuV 2026.06 Therapy.xlsx" -> {jahr, monat}. */
export function parseGuvPeriode(name: string): { jahr: number; monat: number } | null {
  const m = /(\d{4})[.\-_ ](\d{2})/.exec(name);
  return m ? { jahr: Number(m[1]), monat: Number(m[2]) } : null;
}

@Injectable()
export class GuvImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async importiere(buffer: Buffer, dateiname: string, jahrArg: number | null, monatArg: number | null, aktor: { id: string; email: string }): Promise<{ batchId: string; bericht: GuvBericht }> {
    const per = parseGuvPeriode(dateiname);
    const jahr = jahrArg || per?.jahr || 0;
    const stichtagMonat = monatArg || per?.monat || 12;
    if (!jahr || jahr < 2020 || jahr > new Date().getUTCFullYear() + 5) {
      throw new BadRequestException('Jahr nicht erkannt — bitte im Dateinamen „GuV JJJJ.MM Therapy.xlsx" bereitstellen.');
    }

    const adapter = new GuvExcelAdapter(buffer, dateiname);
    const parsed = await adapter.lese();
    if (parsed.positionen.length === 0) {
      throw new BadRequestException('Keine GuV-Positionen erkannt (Struktur/Labels nicht gefunden). Bestehende Daten bleiben unverändert.');
    }

    const batch = await this.prisma.importBatch.create({
      data: { typ: 'GUV', dateiname, hash: adapter.meta().hash, ausgeloestVonId: aktor.id, status: 'HOCHGELADEN', zeilenGesamt: parsed.positionen.length },
    });

    const sortByKey = new Map(GUV_POSITIONEN.map((p, i) => [p.key, i]));
    const rows: Prisma.GuvPositionCreateManyInput[] = parsed.positionen.map((p) => ({
      jahr,
      stichtagMonat,
      positionKey: p.key,
      label: p.label,
      sortierung: sortByKey.get(p.key) ?? 99,
      ebene: p.ebene,
      istEur: Math.round(p.ist * 1000 * 100) / 100,
      pyEur: Math.round(p.py * 1000 * 100) / 100,
      budEur: Math.round(p.bud * 1000 * 100) / 100,
      importBatchId: batch.id,
    }));

    await this.prisma.$transaction([this.prisma.guvPosition.deleteMany({ where: { jahr } }), this.prisma.guvPosition.createMany({ data: rows })]);

    const val = (key: string, feld: 'ist' | 'py' | 'bud'): number => k1(parsed.positionen.find((p) => p.key === key)?.[feld] ?? 0);
    const bericht: GuvBericht = {
      jahr,
      stichtagMonat,
      positionen: rows.length,
      fehlend: parsed.fehlend,
      revenueIst: val('REVENUE', 'ist'),
      operatingResultIst: val('OPERATING_RESULT', 'ist'),
      ebitIst: val('EBIT', 'ist'),
      operatingResultPy: val('OPERATING_RESULT', 'py'),
      operatingResultBud: val('OPERATING_RESULT', 'bud'),
    };

    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: { status: 'ABGESCHLOSSEN', abgeschlossenAm: new Date(), zeilenNeu: rows.length, validierungsbericht: bericht as unknown as Prisma.InputJsonValue },
    });
    await this.audit.write({ entitaet: 'ImportBatch', entitaetId: batch.id, aktion: 'IMPORT', userId: aktor.id, userEmail: aktor.email, metadaten: { typ: 'GUV', ...bericht } });
    return { batchId: batch.id, bericht };
  }
}
