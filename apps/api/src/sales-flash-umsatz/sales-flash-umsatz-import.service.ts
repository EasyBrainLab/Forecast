import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SalesFlashUmsatzAdapter } from './sales-flash-umsatz.adapter';

const CHUNK = 5000;
const k = (eur: number): number => Math.round(eur / 1000); // kEUR, ganzzahlig

export interface SalesFlashUmsatzBericht {
  zeilenGesamt: number;
  jahre: number[];
  summeEurGesamt: number;
  jeJahrMonat: { jahr: number; monat: number; summeKeur: number }[];
  debitorenGesamt: number;
  debitorenOhneStamm: number; // Debitoren, die nicht im D365-Kundenstamm gefunden wurden
  beispieleOhneStamm: string[]; // bis zu 10 Debitornr ohne Stammtreffer
}

@Injectable()
export class SalesFlashUmsatzImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async importiere(buffer: Buffer, dateiname: string, aktor: { id: string; email: string }): Promise<{ batchId: string; bericht: SalesFlashUmsatzBericht }> {
    const adapter = new SalesFlashUmsatzAdapter(buffer, dateiname);
    const rows = await adapter.lese();
    if (rows.length === 0) throw new BadRequestException('Keine Umsatzzeilen erkannt (Struktur/Spalten nicht gefunden). Bestehende Daten bleiben unverändert.');

    const jahre = [...new Set(rows.map((r) => r.jahr))].sort((a, b) => a - b);
    const { dateiname: dn, hash } = adapter.meta();

    const batch = await this.prisma.importBatch.create({
      data: { typ: 'SALES_FLASH_UMSATZ', dateiname: dn, hash, ausgeloestVonId: aktor.id, status: 'HOCHGELADEN', zeilenGesamt: rows.length },
    });

    const daten: Prisma.SalesFlashUmsatzCreateManyInput[] = rows.map((r) => ({
      jahr: r.jahr,
      monat: r.monat,
      dataAreaId: r.dataAreaId,
      debitornr: r.debitornr,
      kundenname: r.kundenname,
      articleNr: r.articleNr,
      articleName: r.articleName,
      kostenstelle: r.kostenstelle,
      kostentraeger: r.kostentraeger,
      e1Kategorie: r.e1Kategorie,
      e2Name: r.e2Name,
      regionCode: r.regionCode,
      landIso: r.landIso,
      rechnungsnr: r.rechnungsnr,
      projektnummer: r.projektnummer,
      betragEur: new Prisma.Decimal(r.betragEur),
      importBatchId: batch.id,
    }));

    // Voll-Ersatz je Jahr (kumulative Lieferung) — alte Zeilen der enthaltenen Jahre entfernen, dann einfügen.
    await this.prisma.$transaction([
      this.prisma.salesFlashUmsatz.deleteMany({ where: { jahr: { in: jahre } } }),
      ...Array.from({ length: Math.ceil(daten.length / CHUNK) }, (_, i) => this.prisma.salesFlashUmsatz.createMany({ data: daten.slice(i * CHUNK, (i + 1) * CHUNK) })),
    ]);

    // Validierungsbericht
    const jmMap = new Map<string, number>();
    let summe = 0;
    const debitoren = new Set<string>();
    for (const r of rows) {
      const key = `${r.jahr}-${r.monat}`;
      jmMap.set(key, (jmMap.get(key) ?? 0) + r.betragEur);
      summe += r.betragEur;
      debitoren.add(`${r.dataAreaId}|${r.debitornr}`);
    }
    // Debitoren gegen D365-Kundenstamm abgleichen
    const stamm = await this.prisma.kundenstamm.findMany({ select: { dataAreaId: true, kundennummer: true } });
    const stammSet = new Set(stamm.map((s) => `${s.dataAreaId}|${s.kundennummer}`));
    const ohneStamm = [...debitoren].filter((d) => !stammSet.has(d));

    const bericht: SalesFlashUmsatzBericht = {
      zeilenGesamt: rows.length,
      jahre,
      summeEurGesamt: Math.round(summe * 100) / 100,
      jeJahrMonat: [...jmMap.entries()]
        .map(([key, eur]) => ({ jahr: Number(key.split('-')[0]), monat: Number(key.split('-')[1]), summeKeur: k(eur) }))
        .sort((a, b) => a.jahr - b.jahr || a.monat - b.monat),
      debitorenGesamt: debitoren.size,
      debitorenOhneStamm: ohneStamm.length,
      beispieleOhneStamm: ohneStamm.slice(0, 10).map((d) => d.split('|')[1]),
    };

    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: { status: 'ABGESCHLOSSEN', abgeschlossenAm: new Date(), zeilenNeu: rows.length, validierungsbericht: bericht as unknown as Prisma.InputJsonValue },
    });
    await this.audit.write({ entitaet: 'ImportBatch', entitaetId: batch.id, aktion: 'IMPORT', userId: aktor.id, userEmail: aktor.email, metadaten: { typ: 'SALES_FLASH_UMSATZ', ...bericht } });
    return { batchId: batch.id, bericht };
  }
}
