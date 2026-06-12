import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AbsatzImportService, parsePeriodeAusDateiname } from '../src/absatz/absatz-import.service';
import { AbsatzService } from '../src/absatz/absatz.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const imp = app.get(AbsatzImportService);
  const svc = app.get(AbsatzService);
  const datenDir = process.env.DATEN_DIR && process.env.DATEN_DIR !== '.' ? process.env.DATEN_DIR : join(__dirname, '../../..');
  const name = 'SF_01_05_2026_qty_by_Region.csv';
  const buffer = readFileSync(join(datenDir, 'docs', name));
  const admin = await prisma.user.findFirstOrThrow({ where: { rolle: 'ADMIN' } });
  const periode = parsePeriodeAusDateiname(name);

  const fails: string[] = [];
  const check = (n: string, c: boolean): void => {
    console.log(`${c ? '✓' : '✗'} ${n}`);
    if (!c) fails.push(n);
  };

  check('Periode aus Dateiname = 2026/5', periode?.jahr === 2026 && periode?.bisMonat === 5);
  const { bericht } = await imp.importiere(buffer, name, periode!, { id: admin.id, email: admin.email });
  console.log('  Bericht:', JSON.stringify(bericht));
  check('Seeds gesamt = 117.284', Math.abs(bericht.seedsGesamt - 117284) < 2);
  check('Seeds Vorjahr = 124.415', Math.abs(bericht.seedsVorjahr - 124415) < 2);
  check('Zeilen importiert > 290', bericht.zeilenImportiert > 290);

  const { bericht: b2 } = await imp.importiere(buffer, name, periode!, { id: admin.id, email: admin.email });
  const cnt = await prisma.absatz.count({ where: { jahr: 2026, bisMonat: 5 } });
  check('Idempotent (Voll-Ersatz, gleiche Zeilenzahl)', cnt === b2.zeilenImportiert);

  const kpi = await svc.kpi(2026, 5);
  console.log('  KPI seeds:', kpi.kennzahlen.seeds, '| Vorjahr', kpi.kennzahlen.seedsVorjahr, '| YoY', kpi.kennzahlen.seedsYoY, '%');
  console.log('  Top-Länder:', kpi.seedsProLand.slice(0, 5).map((l) => `${l.land}:${l.seeds}`).join('  '));
  console.log('  Top-Kunden(3):', kpi.topKunden.slice(0, 3).map((k) => `${k.kunde}:${k.seeds}`).join(' | '));
  check('KPI Seeds = 117.284', Math.abs(kpi.kennzahlen.seeds - 117284) < 2);
  check('YoY berechnet', kpi.kennzahlen.seedsYoY !== null);

  await app.close();
  if (fails.length) {
    console.error(`\n${fails.length} FEHLGESCHLAGEN:`, fails);
    process.exit(1);
  }
  console.log('\nALLE ABSATZ-ASSERTIONS BESTANDEN ✓');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
