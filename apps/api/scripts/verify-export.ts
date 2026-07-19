import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import ExcelJS from 'exceljs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ExportService } from '../src/export/export.service';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { ForecastService } from '../src/forecast/forecast.service';
import { BudgetImportService } from '../src/budget/budget-import.service';
import { IstImportService } from '../src/ist-import/ist-import.service';
import { CsvIstAdapter } from '../src/ist-import/csv-ist.adapter';
import type { RequestUser } from '../src/common/decorators/current-user.decorator';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const exp = app.get(ExportService);

  const adminRec = await prisma.user.findFirstOrThrow({ where: { rolle: 'ADMIN' } });
  const admin: RequestUser = { id: adminRec.id, email: adminRec.email, rolle: 'ADMIN' };
  if ((await prisma.istUmsatz.count()) === 0 || (await prisma.budget.count()) === 0) {
    await prisma.$executeRawUnsafe('TRUNCATE ist_umsatz, import_quarantaene, import_batch, budget RESTART IDENTITY CASCADE');
    const datenDir = process.env.DATEN_DIR && process.env.DATEN_DIR !== '.' ? process.env.DATEN_DIR : join(__dirname, '../../..');
    await app.get(IstImportService).importiere(new CsvIstAdapter(readFileSync(join(datenDir, 'External_Revenue_BU_Therapie.csv')), 'ist.csv'), admin);
    await app.get(BudgetImportService).importiere(readFileSync(join(datenDir, 'Budget_Umsatz_ProLand_ProAGM.xlsx')), 'budget.xlsx', admin);
  }

  const fails: string[] = [];
  const check = (n: string, c: boolean): void => {
    console.log(`${c ? '✓' : '✗'} ${n}`);
    if (!c) fails.push(n);
  };

  // Excel
  const xlsx = await exp.abweichungsbericht(2026, admin);
  check('Excel ist gültiges xlsx (PK-Zip)', xlsx.subarray(0, 2).toString('latin1') === 'PK' && xlsx.length > 2000);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  let gesamtZelle: number | null = null;
  ws.eachRow((row) => {
    if (String(row.getCell(1).value).startsWith('BU-Gesamt')) gesamtZelle = Number(row.getCell(2).value);
  });
  check('Excel enthält BU-Gesamt-Zeile mit Ist YTD ≈ 7647,6 kEUR', gesamtZelle !== null && Math.abs((gesamtZelle as number) - 7647.6) < 0.2);

  // Word
  const docx = await exp.wordReport(2026, admin);
  check('Word ist gültiges docx (PK-Zip)', docx.subarray(0, 2).toString('latin1') === 'PK' && docx.length > 2000);

  // CSV
  const csv = await exp.rohdatenCsv(2026, admin);
  const csvText = csv.toString('utf-8');
  check('CSV mit BOM + ; -Separator + dt. Dezimal', csvText.charCodeAt(0) === 0xfeff && csvText.includes(';') && /\d+,\d{2}/.test(csvText));
  check('CSV enthält Regionen', csvText.includes('AGC') || csvText.includes('AGC'));

  // Konsolidierungs-Monatssicht (XLSX) — Layout + Datentreue gegen die Service-Daten.
  const kd = await app.get(DashboardService).konsolidierungMonatlich(2026, admin);
  const mNr = (p: string): number => Number(p.slice(5));
  const istM = kd.monate.filter((p) => mNr(p) < kd.restAbMonat);
  const fcM = kd.monate.filter((p) => mNr(p) >= kd.restAbMonat);
  let expActual = 0;
  let expForecast = 0;
  let expBud = 0;
  for (const z of kd.zeilen) {
    for (const p of istM) expActual += z.istMonate[p] ?? 0;
    for (const p of fcM) expForecast += z.forecastMonate[p] ?? 0;
    for (const p of kd.monate) expBud += z.budgetMonate[p] ?? 0;
  }

  const konsXlsx = await exp.konsolidierungMonatlichXlsx(2026, admin);
  check('Konsolidierung-Excel ist gültiges xlsx (PK-Zip)', konsXlsx.subarray(0, 2).toString('latin1') === 'PK' && konsXlsx.length > 2000);
  const kwb = new ExcelJS.Workbook();
  await kwb.xlsx.load(konsXlsx as unknown as ArrayBuffer);
  const kws = kwb.worksheets[0];

  // Gruppen-Header (Zeile 2) enthält Actual / Forecast / FY 2026.
  const gruppenTexte: string[] = [];
  kws.getRow(2).eachCell((c) => gruppenTexte.push(String(c.value ?? '')));
  check('Konsolidierung-Excel: Gruppen-Header Actual/Forecast/FY', gruppenTexte.includes('Actual') && gruppenTexte.includes('Forecast') && gruppenTexte.includes('FY 2026'));

  // Spaltenindizes aus der Kopfzeile (Zeile 3) lesen.
  const spalte: Record<string, number> = {};
  kws.getRow(3).eachCell((c, col) => (spalte[String(c.value ?? '')] = col));
  check('Konsolidierung-Excel: ∑-Actual/∑-Forecast/BUD-Spalten vorhanden', !!spalte['∑ Actual'] && !!spalte['∑ Forecast'] && !!spalte['BUD']);

  // Summenzeile „Umsatz" finden und gegen die erwarteten kEUR-Werte prüfen.
  let umsatzRow: ExcelJS.Row | null = null;
  kws.eachRow((row) => {
    if (String(row.getCell(1).value) === 'Umsatz') umsatzRow = row;
  });
  check('Konsolidierung-Excel: Summenzeile „Umsatz" vorhanden', umsatzRow !== null);
  if (umsatzRow) {
    const r = umsatzRow as ExcelJS.Row;
    const zellwert = (name: string): number => Number(r.getCell(spalte[name]).value);
    check('Konsolidierung-Excel: ∑ Actual = Service-Summe (kEUR)', Math.abs(zellwert('∑ Actual') - expActual / 1000) < 0.01);
    check('Konsolidierung-Excel: ∑ Forecast = Service-Summe (kEUR)', Math.abs(zellwert('∑ Forecast') - expForecast / 1000) < 0.01);
    check('Konsolidierung-Excel: BUD = Service-Summe (kEUR)', Math.abs(zellwert('BUD') - expBud / 1000) < 0.01);
  }

  // Forecast-Matrix-Export (AGM-Archiv) — prüft DI (ExportService→ForecastService) + Layout.
  const fsvc = app.get(ForecastService);
  const budRegion = await prisma.budget.findFirst({ where: { jahr: 2026, monat: { in: [7, 8, 9, 10, 11, 12] }, status: 'AKTIV', istRegionsreserve: false, landId: { not: null } }, select: { regionCode: true } });
  if (budRegion) {
    await fsvc.oeffnePeriode('2026-07', budRegion.regionCode, admin);
    const fmXlsx = await exp.forecastMatrixXlsx('2026-07', budRegion.regionCode, admin);
    check('Forecast-Matrix-Export ist gültiges xlsx (PK-Zip)', fmXlsx.subarray(0, 2).toString('latin1') === 'PK' && fmXlsx.length > 2000);
    const fwb = new ExcelJS.Workbook();
    await fwb.xlsx.load(fmXlsx as unknown as ArrayBuffer);
    const fws = fwb.worksheets[0];
    const gruppen: string[] = [];
    fws.getRow(2).eachCell((c) => gruppen.push(String(c.value ?? '')));
    check('Forecast-Matrix-Export: Gruppen-Header Actual/Forecast/FY', gruppen.includes('Actual') && gruppen.includes('Forecast') && gruppen.some((g) => g.startsWith('FY 20')));
    const kopf: string[] = [];
    fws.getRow(3).eachCell((c) => kopf.push(String(c.value ?? '')));
    check('Forecast-Matrix-Export: Kopf mit Produktgruppe + Land', kopf[0] === 'Produktgruppe' && kopf[1] === 'Land');
    let hatSumme = false;
    fws.eachRow((row) => {
      if (String(row.getCell(1).value).startsWith('Summe ')) hatSumme = true;
    });
    check('Forecast-Matrix-Export: Summenzeile vorhanden', hatSumme);
  }

  await app.close();
  if (fails.length) {
    console.error(`\n${fails.length} FEHLGESCHLAGEN:`, fails);
    process.exit(1);
  }
  console.log('\nALLE EXPORT-ASSERTIONS BESTANDEN ✓');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
