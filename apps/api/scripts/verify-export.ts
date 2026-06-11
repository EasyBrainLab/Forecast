import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import ExcelJS from 'exceljs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ExportService } from '../src/export/export.service';
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
  check('Excel enthält BU-Gesamt-Zeile mit Ist YTD ≈ 7487,8 kEUR', gesamtZelle !== null && Math.abs((gesamtZelle as number) - 7487.8) < 0.2);

  // Word
  const docx = await exp.wordReport(2026, admin);
  check('Word ist gültiges docx (PK-Zip)', docx.subarray(0, 2).toString('latin1') === 'PK' && docx.length > 2000);

  // CSV
  const csv = await exp.rohdatenCsv(2026, admin);
  const csvText = csv.toString('utf-8');
  check('CSV mit BOM + ; -Separator + dt. Dezimal', csvText.charCodeAt(0) === 0xfeff && csvText.includes(';') && /\d+,\d{2}/.test(csvText));
  check('CSV enthält Regionen', csvText.includes('AGC') || csvText.includes('AGC'));

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
