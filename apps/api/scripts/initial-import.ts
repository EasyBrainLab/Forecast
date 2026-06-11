import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { BudgetImportService } from '../src/budget/budget-import.service';
import { IstImportService } from '../src/ist-import/ist-import.service';
import { CsvIstAdapter } from '../src/ist-import/csv-ist.adapter';

// Produktiver Initial-Import der 3 Realdateien (Entscheidung 2). Idempotent (RECID-/Budget-Versionierung).
const IST_SOLL = 45_146_016.97; // importierte Summe (ohne 1 Quarantäne-Zeile)

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const datenDir = process.env.DATEN_DIR && process.env.DATEN_DIR !== '.' ? process.env.DATEN_DIR : process.cwd();
  const admin = await prisma.user.findFirstOrThrow({ where: { rolle: 'ADMIN' } });
  const aktor = { id: admin.id, email: admin.email };

  console.log('1/2 Budget-Import…');
  const bud = await app.get(BudgetImportService).importiere(readFileSync(join(datenDir, 'Budget_Umsatz_ProLand_ProAGM.xlsx')), 'Budget_Umsatz_ProLand_ProAGM.xlsx', aktor);
  console.log(`   Budget-Zeilen: ${bud.bericht.budgetZeilen}, Quarantäne: ${bud.bericht.zeilenQuarantaene}`);

  console.log('2/2 Ist-Import…');
  const ist = await app.get(IstImportService).importiere(new CsvIstAdapter(readFileSync(join(datenDir, 'External_Revenue_BU_Therapie.csv')), 'External_Revenue_BU_Therapie.csv'), aktor);
  const b = ist.bericht;
  console.log(`   Ist-Zeilen: gesamt=${b.zeilenGesamt} neu=${b.zeilenNeu} aktualisiert=${b.zeilenAktualisiert} quarantäne=${b.zeilenQuarantaene} Σ=${b.summeGesamtEur}`);

  if (Math.abs(b.summeGesamtEur - IST_SOLL) > 0.05) {
    throw new Error(`ABNAHME FEHLGESCHLAGEN: Ist-Summe ${b.summeGesamtEur} != Soll ${IST_SOLL}`);
  }
  console.log('\n✓ Initial-Import abgeschlossen, Abnahme-Assertion erfüllt.');
  if (b.zeilenQuarantaene > 0) console.log(`  Hinweis: ${b.zeilenQuarantaene} Zeile(n) in Quarantäne — im Admin-UI klären.`);
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
