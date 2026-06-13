import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parse } from 'csv-parse/sync';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

function num(s: string | undefined): number {
  const t = (s ?? '').trim().replace(/^"|"$/g, '').replace(/%/g, '').replace(/\./g, '').replace(',', '.').trim();
  if (t === '' || t === '-') return 0;
  const n = Number(t);
  return Number.isNaN(n) ? 0 : n;
}

export interface AbsatzBericht {
  jahr: number;
  bisMonat: number;
  zeilenGesamt: number;
  zeilenImportiert: number;
  zeilenUebersprungen: number;
  seedsGesamt: number;
  seedsVorjahr: number;
  ruthenGesamt: number;
}

/** Parst die Periode aus dem Dateinamen, z.B. "SF_01_05_2026_qty_by_Region.csv" -> {jahr:2026, bisMonat:5}. */
export function parsePeriodeAusDateiname(name: string): { jahr: number; bisMonat: number } | null {
  const m = /SF_(\d{2})_(\d{2})_(\d{4})/i.exec(name);
  if (!m) return null;
  return { jahr: Number(m[3]), bisMonat: Number(m[2]) };
}

@Injectable()
export class AbsatzImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async importiere(buffer: Buffer, dateiname: string, periode: { jahr: number; bisMonat: number }, aktor: { id: string; email: string }): Promise<{ batchId: string; bericht: AbsatzBericht }> {
    const records = parse(buffer, { bom: true, delimiter: ',', columns: true, skip_empty_lines: true, trim: false }) as Record<string, string>[];
    const laender = new Set((await this.prisma.land.findMany({ select: { isoCode: true } })).map((l) => l.isoCode));
    // Kunden->Region-Mapping für AGM-Scoping (nicht zugeordnet -> regionCode null, nur BU-weit sichtbar)
    const kundeRegion = new Map((await this.prisma.kundeRegion.findMany({ select: { kunde: true, regionCode: true } })).map((k) => [k.kunde, k.regionCode]));

    const batch = await this.prisma.importBatch.create({
      data: { typ: 'ABSATZ', dateiname, hash: createHash('sha256').update(buffer).digest('hex'), ausgeloestVonId: aktor.id, status: 'HOCHGELADEN', zeilenGesamt: records.length },
    });

    const inserts: Prisma.AbsatzCreateManyInput[] = [];
    let uebersprungen = 0;
    let seedsGesamt = 0;
    let seedsVorjahr = 0;
    let ruthenGesamt = 0;

    for (const r of records) {
      const iso = (r['Country'] ?? '').trim().toUpperCase();
      if (!iso || !laender.has(iso)) {
        uebersprungen++;
        continue;
      }
      const seeds = num(r['Seeds']);
      const seedsPY = num(r['SeedsPY']);
      const ruthen = num(r['Ruthen']);
      seedsGesamt += seeds;
      seedsVorjahr += seedsPY;
      ruthenGesamt += ruthen;
      const kunde = (r['SOL_DELIVERYADDRESSNAME'] ?? '').trim() || 'Unbekannt';
      inserts.push({
        jahr: periode.jahr,
        bisMonat: periode.bisMonat,
        landId: iso,
        kunde,
        regionCode: kundeRegion.get(kunde) ?? null,
        stadt: (r['SO_DELIVERYADDRESSCITY'] ?? '').trim() || null,
        seeds,
        seedsVorjahr: seedsPY,
        ruthen,
        ruthenVorjahr: num(r['RuthenPY']),
        icTotal: num(r['IC Total']),
        isTotal: num(r['IS total']),
        s16: num(r['QTYS16Sold']),
        s16Vorjahr: num(r['QTYS16SoldPY']),
        details: r as unknown as Prisma.InputJsonValue,
        importBatchId: batch.id,
      });
    }

    // Schutz: niemals eine bestehende Periode löschen, wenn die Datei keine validen Zeilen liefert
    // (falsche Spalten/leere/kaputte Datei). Sonst würde der Voll-Ersatz die Periode leeren.
    if (inserts.length === 0) {
      await this.prisma.importBatch.update({ where: { id: batch.id }, data: { status: 'FEHLGESCHLAGEN', abgeschlossenAm: new Date(), zeilenUebersprungen: uebersprungen } });
      throw new BadRequestException(`Keine validen Absatzzeilen erkannt (${uebersprungen} übersprungen). Bestehende Daten der Periode ${periode.jahr}-${String(periode.bisMonat).padStart(2, '0')} bleiben unverändert. Bitte Datei/Spalten (Country, Seeds, …) prüfen.`);
    }

    // Voll-Ersatz der Periode (Datei ist ein kumulativer Snapshot)
    await this.prisma.$transaction([
      this.prisma.absatz.deleteMany({ where: { jahr: periode.jahr, bisMonat: periode.bisMonat } }),
      this.prisma.absatz.createMany({ data: inserts }),
    ]);

    const bericht: AbsatzBericht = {
      jahr: periode.jahr,
      bisMonat: periode.bisMonat,
      zeilenGesamt: records.length,
      zeilenImportiert: inserts.length,
      zeilenUebersprungen: uebersprungen,
      seedsGesamt: Math.round(seedsGesamt),
      seedsVorjahr: Math.round(seedsVorjahr),
      ruthenGesamt: Math.round(ruthenGesamt),
    };
    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: { status: 'ABGESCHLOSSEN', abgeschlossenAm: new Date(), zeilenNeu: inserts.length, zeilenUebersprungen: uebersprungen, validierungsbericht: bericht as unknown as Prisma.InputJsonValue },
    });
    await this.audit.write({ entitaet: 'ImportBatch', entitaetId: batch.id, aktion: 'IMPORT', userId: aktor.id, userEmail: aktor.email, metadaten: { typ: 'ABSATZ', ...bericht } });
    return { batchId: batch.id, bericht };
  }
}
