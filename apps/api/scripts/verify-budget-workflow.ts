import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { BudgetAenderungService } from '../src/budget/budget-aenderung.service';
import { BudgetImportService } from '../src/budget/budget-import.service';
import type { RequestUser } from '../src/common/decorators/current-user.decorator';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const svc = app.get(BudgetAenderungService);

  // sauberer Workflow-Zustand: Budget frisch importieren (immer Version 1, deterministisch)
  await prisma.$executeRawUnsafe('TRUNCATE budget, budget_aenderung_event, budget_aenderung RESTART IDENTITY CASCADE');
  const datenDir = process.env.DATEN_DIR && process.env.DATEN_DIR !== '.' ? process.env.DATEN_DIR : join(__dirname, '../../..');
  const buffer = readFileSync(join(datenDir, 'Budget_Umsatz_ProLand_ProAGM.xlsx'));
  const admin = await prisma.user.findFirstOrThrow({ where: { rolle: 'ADMIN' } });
  await app.get(BudgetImportService).importiere(buffer, 'Budget.xlsx', admin);

  await prisma.regionsVerantwortung.deleteMany({ where: { user: { email: { endsWith: '@wf.test' } } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: '@wf.test' } } });

  const mk = async (email: string, rolle: 'AGM' | 'VERTRIEBSLEITER' | 'BU_LEITER'): Promise<RequestUser> => {
    const u = await prisma.user.create({ data: { email, name: email, rolle, status: 'VERIFIZIERT', passwortHash: 'x' } });
    return { id: u.id, email: u.email, rolle };
  };
  const agm = await mk('agm@wf.test', 'AGM');
  const vl = await mk('vl@wf.test', 'VERTRIEBSLEITER');
  const bu = await mk('bu@wf.test', 'BU_LEITER');

  const budget = await prisma.budget.findFirstOrThrow({ where: { status: 'AKTIV', wertEur: { not: null }, istRegionsreserve: false } });
  await prisma.regionsVerantwortung.create({ data: { userId: agm.id, regionCode: budget.regionCode, gueltigVon: new Date('2020-01-01') } });

  const fails: string[] = [];
  const check = (n: string, c: boolean): void => {
    console.log(`${c ? '✓' : '✗'} ${n}`);
    if (!c) fails.push(n);
  };
  const expect403 = async (n: string, fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn();
      check(n, false);
    } catch (e) {
      check(n, (e as { status?: number }).status === 403);
    }
  };
  const expectStatus = async (n: string, code: number, fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn();
      check(n, false);
    } catch (e) {
      check(n, (e as { status?: number }).status === code);
    }
  };

  const altWert = Number(budget.wertEur);

  // Szenario A: Happy Path AGM -> VL -> BU -> AKTIV
  console.log('== Szenario A: Happy Path ==');
  const a = await svc.create({ budgetId: budget.id, jahr: budget.jahr, regionCode: budget.regionCode, landId: budget.landId ?? undefined, e1Id: budget.e1Id, neuWertEur: altWert + 1000, begruendung: 'Markterweiterung' }, agm);
  await svc.beantragen(a.id, agm);
  // ungültiger Übergang: BU-Freigabe vor VL-Freigabe -> 409
  await expectStatus('BU-Freigabe vor VL-Freigabe → 409', 409, () => svc.freigabeBu(a.id, bu));
  await svc.freigabeVl(a.id, vl);
  const rBu = await svc.freigabeBu(a.id, bu);
  check('Endstatus AKTIV', rBu.status === 'AKTIV');
  const altDb = await prisma.budget.findUniqueOrThrow({ where: { id: budget.id } });
  check('alte Budgetversion HISTORISIERT', altDb.status === 'HISTORISIERT');
  const neu = await prisma.budget.findFirst({ where: { jahr: budget.jahr, regionCode: budget.regionCode, landId: budget.landId, e1Id: budget.e1Id, status: 'AKTIV', version: budget.version + 1 } });
  check('neue AKTIV-Budgetversion mit neuem Wert', !!neu && Math.abs(Number(neu.wertEur) - (altWert + 1000)) < 0.01);
  const events = await prisma.budgetAenderungEvent.count({ where: { aenderungId: a.id } });
  check('Event-Kette vollständig (ENTWURF,BEANTRAGT,FREIGABE_VL,FREIGABE_BU,AKTIV = 5)', events === 5);

  // Append-only: Event darf nicht gelöscht werden (P0001)
  let blocked = false;
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM budget_aenderung_event WHERE "aenderungId" = '${a.id}'`);
  } catch {
    blocked = true;
  }
  check('Event-Löschung blockiert (append-only P0001)', blocked);

  // Szenario B: 4-Augen — Antragsteller (BU) darf nicht selbst final freigeben
  console.log('== Szenario B: 4-Augen-Prinzip ==');
  const budget2 = await prisma.budget.findFirstOrThrow({ where: { status: 'AKTIV', wertEur: { not: null }, istRegionsreserve: false, id: { not: budget.id } } });
  const b = await svc.create({ budgetId: budget2.id, jahr: budget2.jahr, regionCode: budget2.regionCode, landId: budget2.landId ?? undefined, e1Id: budget2.e1Id, neuWertEur: Number(budget2.wertEur) + 500, begruendung: 'Test 4-Augen' }, bu);
  await svc.beantragen(b.id, bu);
  await svc.freigabeVl(b.id, vl);
  await expect403('BU (=Antragsteller) Selbstfreigabe → 403', () => svc.freigabeBu(b.id, bu));

  // Szenario C: falsche Rolle — frische Änderung im Status BEANTRAGT, AGM hat Scope
  console.log('== Szenario C: Rollenschutz ==');
  if (budget2.regionCode !== budget.regionCode) {
    await prisma.regionsVerantwortung.create({ data: { userId: agm.id, regionCode: budget2.regionCode, gueltigVon: new Date('2020-01-01') } });
  }
  const c = await svc.create({ budgetId: budget2.id, jahr: budget2.jahr, regionCode: budget2.regionCode, landId: budget2.landId ?? undefined, e1Id: budget2.e1Id, neuWertEur: Number(budget2.wertEur) + 250, begruendung: 'Test Rolle' }, bu);
  await svc.beantragen(c.id, bu);
  await expect403('AGM versucht VL-Freigabe → 403 (Rollen-Guard)', () => svc.freigabeVl(c.id, agm));

  await app.close();
  if (fails.length) {
    console.error(`\n${fails.length} FEHLGESCHLAGEN:`, fails);
    process.exit(1);
  }
  console.log('\nALLE BUDGET-WORKFLOW-ASSERTIONS BESTANDEN ✓');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
