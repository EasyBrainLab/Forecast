import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IstImportService } from '../src/ist-import/ist-import.service';
import { CsvIstAdapter } from '../src/ist-import/csv-ist.adapter';
import { PrismaService } from '../src/prisma/prisma.service';

// Authoritative Sollwerte (aus der CSV mit exakter Mapping-Logik berechnet).
const EXPECTED_TOTAL = 45_146_016.97;
const EXPECTED_REGIONS: Record<string, number> = {
  AGC: 11_894_547.76,
  CS: 14_814_449.89,
  EMA: 5_282_614.48,
  EP: 7_982_685.58,
  WIA: 5_146_465.91,
  ZENTRAL: 25_253.35,
};
const EXPECTED_NEU = 10_042; // 10043 - 1 Quarantäne (leeres Country)

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const service = app.get(IstImportService);

  await prisma.$executeRawUnsafe('TRUNCATE ist_umsatz, import_quarantaene, import_batch, audit_trail RESTART IDENTITY CASCADE');

  const datenDir = process.env.DATEN_DIR && process.env.DATEN_DIR !== '.' ? process.env.DATEN_DIR : join(__dirname, '../../..');
  const buffer = readFileSync(join(datenDir, 'External_Revenue_BU_Therapie.csv'));
  const aktor = await prisma.user.findFirstOrThrow({ where: { rolle: 'ADMIN' } });

  const fails: string[] = [];
  const check = (name: string, cond: boolean): void => {
    console.log(`${cond ? '✓' : '✗'} ${name}`);
    if (!cond) fails.push(name);
  };

  console.log('== Import 1 ==');
  const b1 = (await service.importiere(new CsvIstAdapter(buffer, 'External_Revenue_BU_Therapie.csv'), aktor)).bericht;
  console.log(`  gesamt=${b1.zeilenGesamt} neu=${b1.zeilenNeu} quar=${b1.zeilenQuarantaene} e2Unbekannt=${b1.e2Unbekannt} vorzeichen=${b1.vorzeichenVerstoesse} summe=${b1.summeGesamtEur}`);
  check('zeilenGesamt = 10043', b1.zeilenGesamt === 10043);
  check(`zeilenNeu = ${EXPECTED_NEU}`, b1.zeilenNeu === EXPECTED_NEU);
  check('Quarantäne = 1 (leeres Country)', b1.zeilenQuarantaene === 1);
  check('e2Unbekannt = 2 (leere KTREB2)', b1.e2Unbekannt === 2);
  check('Vorzeichen-Verstöße = 0', b1.vorzeichenVerstoesse === 0);
  check(`Σ = ${EXPECTED_TOTAL}`, Math.abs(b1.summeGesamtEur - EXPECTED_TOTAL) < 0.01);
  for (const [reg, exp] of Object.entries(EXPECTED_REGIONS)) {
    const got = b1.summenJeRegion.find((s) => s.regionCode === reg)?.summeEur ?? -1;
    check(`Region ${reg} = ${exp}`, Math.abs(got - exp) < 0.01);
  }
  const pg = await prisma.istUmsatz.count({ where: { landId: 'PG' } });
  check('pg→PG importiert (2 Zeilen)', pg === 2);

  console.log('== Import 2 (Idempotenz) ==');
  const b2 = (await service.importiere(new CsvIstAdapter(buffer, 'External_Revenue_BU_Therapie.csv'), aktor)).bericht;
  console.log(`  neu=${b2.zeilenNeu} aktualisiert=${b2.zeilenAktualisiert} übersprungen=${b2.zeilenUebersprungen}`);
  check('Re-Import neu = 0', b2.zeilenNeu === 0);
  check('Re-Import aktualisiert = 0', b2.zeilenAktualisiert === 0);
  check('Re-Import Σ unverändert', Math.abs(b2.summeGesamtEur - EXPECTED_TOTAL) < 0.01);

  const count = await prisma.istUmsatz.count();
  check(`IstUmsatz-Zeilen = ${EXPECTED_NEU}`, count === EXPECTED_NEU);

  await app.close();
  if (fails.length) {
    console.error(`\n${fails.length} ASSERTION(EN) FEHLGESCHLAGEN:`, fails);
    process.exit(1);
  }
  console.log('\nALLE ASSERTIONS BESTANDEN ✓');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
