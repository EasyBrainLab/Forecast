import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { BudgetImportService } from '../src/budget/budget-import.service';
import { PrismaService } from '../src/prisma/prisma.service';

const EXPECTED = {
  budgetZeilen: 2905,
  reserveZeilen: 7,
  jahr: {
    2024: 19_810_219.47,
    2025: 17_162_179.48,
    2026: 17_092_365.98,
    2027: 16_855_596.63,
    2028: 17_293_426.06,
    2029: 17_288_108.25,
    2030: 17_711_606.03,
  } as Record<number, number>,
  units2026: 306_081.88,
};

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const service = app.get(BudgetImportService);

  await prisma.$executeRawUnsafe('TRUNCATE budget, budget_aenderung_event, budget_aenderung RESTART IDENTITY CASCADE');
  const datenDir = process.env.DATEN_DIR && process.env.DATEN_DIR !== '.' ? process.env.DATEN_DIR : join(__dirname, '../../..');
  const buffer = readFileSync(join(datenDir, 'Budget_Umsatz_ProLand_ProAGM.xlsx'));
  const aktor = await prisma.user.findFirstOrThrow({ where: { rolle: 'ADMIN' } });

  const fails: string[] = [];
  const check = (n: string, c: boolean): void => {
    console.log(`${c ? '✓' : '✗'} ${n}`);
    if (!c) fails.push(n);
  };

  console.log('== Budget-Import 1 ==');
  const b = (await service.importiere(buffer, 'Budget_Umsatz_ProLand_ProAGM.xlsx', aktor)).bericht;
  console.log(`  budgetZeilen=${b.budgetZeilen} reserve=${b.reserveZeilen} quar=${b.zeilenQuarantaene} units2026=${b.units2026}`);
  console.log('  ' + b.summenJeJahr.map((s) => `${s.jahr}:${s.summeEur}`).join('  '));

  check('Quarantäne = 0', b.zeilenQuarantaene === 0);
  check(`budgetZeilen = ${EXPECTED.budgetZeilen}`, b.budgetZeilen === EXPECTED.budgetZeilen);
  check(`reserveZeilen = ${EXPECTED.reserveZeilen}`, b.reserveZeilen === EXPECTED.reserveZeilen);
  check(`units2026 = ${EXPECTED.units2026}`, Math.abs(b.units2026 - EXPECTED.units2026) < 0.01);
  for (const [j, exp] of Object.entries(EXPECTED.jahr)) {
    const got = b.summenJeJahr.find((s) => s.jahr === Number(j))?.summeEur ?? -1;
    // Toleranz 0,10 EUR: Sub-Cent-Differenz aus Rundungskonvention (JS half-up vs. Python banker's).
    check(`EUR ${j} ≈ ${exp}`, Math.abs(got - exp) < 0.1);
  }

  const cnt = await prisma.budget.count();
  check(`Budget-DB-Zeilen = ${EXPECTED.budgetZeilen}`, cnt === EXPECTED.budgetZeilen);
  const reserveLandlos = await prisma.budget.count({ where: { istRegionsreserve: true, landId: null } });
  const reserveGesamt = await prisma.budget.count({ where: { istRegionsreserve: true } });
  check('Regionsreserve landlos (landId null)', reserveGesamt > 0 && reserveLandlos === reserveGesamt);

  console.log('== Budget-Import 2 (Idempotenz) ==');
  await service.importiere(buffer, 'Budget_Umsatz_ProLand_ProAGM.xlsx', aktor);
  const cnt2 = await prisma.budget.count();
  check('Idempotent: keine neuen Budget-Zeilen', cnt2 === EXPECTED.budgetZeilen);

  await app.close();
  if (fails.length) {
    console.error(`\n${fails.length} FEHLGESCHLAGEN:`, fails);
    process.exit(1);
  }
  console.log('\nALLE BUDGET-ASSERTIONS BESTANDEN ✓');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
