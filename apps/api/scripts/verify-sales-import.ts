import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SalesImportService } from '../src/sales-import/sales-import.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const svc = app.get(SalesImportService);

  await prisma.$executeRawUnsafe('TRUNCATE verkaufsrechnung_position, verkaufsrechnung, kundenstamm RESTART IDENTITY CASCADE');
  const datenDir = process.env.DATEN_DIR && process.env.DATEN_DIR !== '.' ? process.env.DATEN_DIR : join(__dirname, '../../..', 'docs');
  const admin = await prisma.user.findFirstOrThrow({ where: { rolle: 'ADMIN' } });
  const aktor = { id: admin.id, email: admin.email };
  const buf = (name: string): Buffer => readFileSync(join(datenDir, name));

  const fails: string[] = [];
  const check = (n: string, c: boolean, extra?: unknown): void => {
    console.log(`${c ? '✓' : '✗'} ${n}${extra !== undefined ? `  (${JSON.stringify(extra)})` : ''}`);
    if (!c) fails.push(n);
  };

  // 1) Kundenstamm
  const ks = await svc.importiereKundenstamm(buf('dbo.CustCustomerV3_20260715.xlsx'), 'CustCustomerV3.xlsx', aktor);
  const ksCount = await prisma.kundenstamm.count();
  check('Kundenstamm importiert (406)', ksCount === 406, { count: ksCount, neu: ks.bericht.zeilenNeu, quar: ks.bericht.zeilenQuarantaene });
  check('Kundenstamm: neu + quarantaene = gesamt', ks.bericht.zeilenNeu + ks.bericht.zeilenQuarantaene === ks.bericht.zeilenGesamt);

  // 2) Rechnungsköpfe
  const hd = await svc.importiereRechnungen(buf('dboSalesINvoiceHeaderV2SAtaging.xlsx'), 'Header.xlsx', aktor);
  const hdCount = await prisma.verkaufsrechnung.count();
  check('Rechnungsköpfe importiert (~27436)', hdCount > 27000, { count: hdCount, neu: hd.bericht.zeilenNeu, quar: hd.bericht.zeilenQuarantaene });
  check('Köpfe: neu + skip + quarantaene = gesamt', hd.bericht.zeilenNeu + hd.bericht.zeilenUebersprungen + hd.bericht.zeilenQuarantaene === hd.bericht.zeilenGesamt);
  check('Köpfe: mehrere Währungen im Bericht', Object.keys((hd.bericht.detail as { summeJeWaehrung: object }).summeJeWaehrung).length >= 2, (hd.bericht.detail as { summeJeWaehrung: object }).summeJeWaehrung);
  check('Köpfe: Gutschriften erkannt', (hd.bericht.detail as { gutschriften: number }).gutschriften > 0, (hd.bericht.detail as { gutschriften: number }).gutschriften);

  // 3) Positionen (streaming)
  const pos = await svc.importierePositionen(buf('dboSalesInvoiceLines.xlsx'), 'Lines.xlsx', aktor);
  const posCount = await prisma.verkaufsrechnungsposition.count();
  check('Positionen importiert (~129888)', posCount > 120000, { count: posCount, neu: pos.bericht.zeilenNeu, quar: pos.bericht.zeilenQuarantaene, skip: pos.bericht.zeilenUebersprungen });
  check('Positionen: neu + skip + quarantaene = gesamt', pos.bericht.zeilenNeu + pos.bericht.zeilenUebersprungen + pos.bericht.zeilenQuarantaene === pos.bericht.zeilenGesamt);

  // 4) Denormalisierung: Position.kundennummer stimmt mit Kopf überein
  const p = await prisma.verkaufsrechnungsposition.findFirstOrThrow();
  const k = await prisma.verkaufsrechnung.findUnique({ where: { dataAreaId_rechnungsnummer: { dataAreaId: p.dataAreaId, rechnungsnummer: p.rechnungsnummer } } });
  check('Denormalisierung: Position.kundennummer = Kopf.kundennummer', !!k && k.kundennummer === p.kundennummer, { pos: p.kundennummer, kopf: k?.kundennummer });

  // 5) Gutschrift (Minusbetrag) importiert
  const neg = await prisma.verkaufsrechnungsposition.count({ where: { betrag: { lt: 0 } } });
  check('Gutschriften (Minusbetrag) importiert', neg > 0, { negative: neg });

  // 6) Idempotenz: zweiter Lauf der Köpfe -> 0 neu, alles skip
  const hd2 = await svc.importiereRechnungen(buf('dboSalesINvoiceHeaderV2SAtaging.xlsx'), 'Header.xlsx', aktor);
  check('Idempotenz Köpfe: 0 neu beim zweiten Lauf', hd2.bericht.zeilenNeu === 0, { neu: hd2.bericht.zeilenNeu, skip: hd2.bericht.zeilenUebersprungen });
  check('Idempotenz: Kopf-Anzahl unverändert', (await prisma.verkaufsrechnung.count()) === hdCount);

  // 7) Idempotenz Kundenstamm: zweiter Lauf -> 0 neu, alle aktualisiert
  const ks2 = await svc.importiereKundenstamm(buf('dbo.CustCustomerV3_20260715.xlsx'), 'CustCustomerV3.xlsx', aktor);
  check('Idempotenz Kundenstamm: 0 neu, Anzahl stabil', ks2.bericht.zeilenNeu === 0 && (await prisma.kundenstamm.count()) === 406, { neu: ks2.bericht.zeilenNeu, akt: ks2.bericht.zeilenAktualisiert });

  await app.close();
  if (fails.length) {
    console.error(`\n${fails.length} FEHLGESCHLAGEN:`, fails);
    process.exit(1);
  }
  console.log('\nALLE SALES-IMPORT-ASSERTIONS BESTANDEN ✓');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
