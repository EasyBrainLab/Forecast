import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { BudgetImportService } from '../src/budget/budget-import.service';
import { IstImportService } from '../src/ist-import/ist-import.service';
import { CsvIstAdapter } from '../src/ist-import/csv-ist.adapter';
import type { RequestUser } from '../src/common/decorators/current-user.decorator';

// forecast-relevante Regionen (ZENTRAL ausgeschlossen): Σ YTD 2026 Monate 1-5
const REGION_YTD: Record<string, number> = { EP: 1_360_169.5, WIA: 877_020.45, EMA: 826_990.4, AGC: 2_304_014.7, CS: 2_119_615.56 };
const GESAMT_YTD = 7_487_810.61;
const BUDGET_2026 = 17_092_365.98;

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const dash = app.get(DashboardService);

  await prisma.$executeRawUnsafe('TRUNCATE ist_umsatz, import_quarantaene, import_batch, budget, forecast_version, forecast_periode, budget_aenderung_event, budget_aenderung, audit_trail RESTART IDENTITY CASCADE');
  const datenDir = process.env.DATEN_DIR && process.env.DATEN_DIR !== '.' ? process.env.DATEN_DIR : join(__dirname, '../../..');
  const adminRec = await prisma.user.findFirstOrThrow({ where: { rolle: 'ADMIN' } });
  const admin: RequestUser = { id: adminRec.id, email: adminRec.email, rolle: 'ADMIN' };
  await app.get(IstImportService).importiere(new CsvIstAdapter(readFileSync(join(datenDir, 'External_Revenue_BU_Therapie.csv')), 'ist.csv'), admin);
  await app.get(BudgetImportService).importiere(readFileSync(join(datenDir, 'Budget_Umsatz_ProLand_ProAGM.xlsx')), 'budget.xlsx', admin);

  await prisma.regionsVerantwortung.deleteMany({ where: { user: { email: { endsWith: '@db.test' } } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: '@db.test' } } });
  const agmRec = await prisma.user.create({ data: { email: 'agm@db.test', name: 'AGM', rolle: 'AGM', status: 'VERIFIZIERT', passwortHash: 'x' } });
  const agm: RequestUser = { id: agmRec.id, email: agmRec.email, rolle: 'AGM' };
  await prisma.regionsVerantwortung.create({ data: { userId: agm.id, regionCode: 'AGC', gueltigVon: new Date('2020-01-01') } });

  const fails: string[] = [];
  const check = (n: string, c: boolean): void => {
    console.log(`${c ? '✓' : '✗'} ${n}`);
    if (!c) fails.push(n);
  };

  // BU/Admin-Konsolidierung 2026
  const k = await dash.konsolidierung(2026, admin);
  console.log(`  Stichtag=${k.stichtag} Gesamt Ist YTD=${k.gesamt.istYtd} Budget=${k.gesamt.budget}`);
  check(`Gesamt Ist YTD 2026 = ${GESAMT_YTD}`, Math.abs(k.gesamt.istYtd - GESAMT_YTD) < 0.05);
  check(`Gesamt Budget 2026 ≈ ${BUDGET_2026}`, Math.abs(k.gesamt.budget - BUDGET_2026) < 0.2);
  for (const [r, exp] of Object.entries(REGION_YTD)) {
    const got = k.zeilen.find((z) => z.regionCode === r)?.istYtd ?? -1;
    check(`Region ${r} Ist YTD = ${exp}`, Math.abs(got - exp) < 0.05);
  }
  check('ZENTRAL nicht in Konsolidierung (nicht forecast-relevant)', !k.zeilen.some((z) => z.regionCode === 'ZENTRAL'));
  check('YEE = Ist YTD + Forecast-Rest (ohne Forecast: YEE=Ist)', Math.abs(k.gesamt.yee - k.gesamt.istYtd) < 0.05);

  // AGM-Scope: nur eigene Region
  const ka = await dash.konsolidierung(2026, agm);
  check('AGM sieht nur 1 Region', ka.zeilen.length === 1 && ka.zeilen[0]?.regionCode === 'AGC');
  check('AGM Ist YTD = AGC-Wert', Math.abs(ka.gesamt.istYtd - REGION_YTD.AGC) < 0.05);

  // Bereinigte Sicht: größte 2026-YTD-Buchung als Sondereffekt markieren
  const top = await prisma.istUmsatz.findFirstOrThrow({ where: { jahr: 2026, monat: { lt: 6 } }, orderBy: { wertEur: 'desc' } });
  await dash.markSondereffekt(top.recid, true, 'Einmaleffekt HDR', admin);
  const kb = await dash.konsolidierung(2026, admin, true);
  check('bereinigt < unbereinigt (Sondereffekt herausgerechnet)', Math.abs(k.gesamt.istYtd - kb.gesamt.istYtd - Number(top.wertEur)) < 0.05);

  // Drill-down smoke
  const dd = await dash.drilldown(2026, admin, { regionCode: 'AGC' });
  check('Drill-down AGC liefert E1-Ebene', dd.ebene === 'E1' && dd.zeilen.length > 0);

  await app.close();
  if (fails.length) {
    console.error(`\n${fails.length} FEHLGESCHLAGEN:`, fails);
    process.exit(1);
  }
  console.log('\nALLE DASHBOARD-ASSERTIONS BESTANDEN ✓');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
