import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ForecastService } from '../src/forecast/forecast.service';
import { BudgetImportService } from '../src/budget/budget-import.service';
import type { RequestUser } from '../src/common/decorators/current-user.decorator';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const svc = app.get(ForecastService);

  await prisma.$executeRawUnsafe('TRUNCATE forecast_version, forecast_periode, budget, budget_aenderung_event, budget_aenderung RESTART IDENTITY CASCADE');
  const datenDir = process.env.DATEN_DIR && process.env.DATEN_DIR !== '.' ? process.env.DATEN_DIR : join(__dirname, '../../..');
  const buffer = readFileSync(join(datenDir, 'Budget_Umsatz_ProLand_ProAGM.xlsx'));
  const adminRec = await prisma.user.findFirstOrThrow({ where: { rolle: 'ADMIN' } });
  await app.get(BudgetImportService).importiere(buffer, 'Budget.xlsx', adminRec);

  await prisma.regionsVerantwortung.deleteMany({ where: { user: { email: { endsWith: '@fc.test' } } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: '@fc.test' } } });
  const mk = async (email: string, rolle: 'AGM' | 'VERTRIEBSLEITER'): Promise<RequestUser> => {
    const u = await prisma.user.create({ data: { email, name: email, rolle, status: 'VERIFIZIERT', passwortHash: 'x' } });
    return { id: u.id, email: u.email, rolle };
  };
  const admin: RequestUser = { id: adminRec.id, email: adminRec.email, rolle: 'ADMIN' };
  const system: RequestUser = { id: adminRec.id, email: 'SYSTEM', rolle: 'BU_LEITER' };
  const agm = await mk('agm@fc.test', 'AGM');
  const vl = await mk('vl@fc.test', 'VERTRIEBSLEITER');

  const b = await prisma.budget.findFirstOrThrow({ where: { jahr: 2026, monat: { in: [6, 7, 8, 9, 10, 11, 12] }, status: 'AKTIV', istRegionsreserve: false, landId: { not: null } }, select: { regionCode: true } });
  const region = b.regionCode;
  const periode = '2026-06';
  await prisma.regionsVerantwortung.create({ data: { userId: agm.id, regionCode: region, gueltigVon: new Date('2020-01-01') } });

  const fails: string[] = [];
  const check = (n: string, c: boolean): void => {
    console.log(`${c ? '✓' : '✗'} ${n}`);
    if (!c) fails.push(n);
  };
  const expectStatus = async (n: string, code: number, fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn();
      check(n, false);
    } catch (e) {
      check(n, (e as { status?: number }).status === code);
    }
  };

  console.log(`Region=${region} Periode=${periode}`);
  await svc.oeffnePeriode(periode, region, admin);
  const p0 = await prisma.forecastPeriode.findUniqueOrThrow({ where: { periode_regionCode: { periode, regionCode: region } } });
  check('Periode OFFEN', p0.status === 'OFFEN');
  const seeded = await prisma.forecastVersion.count({ where: { periode, regionCode: region } });
  check('OFFEN-Versionen aus Budget geseedet', seeded > 0);

  check('F1 OFFEN→BESTAETIGT', (await svc.bestaetigen(periode, region, agm)).status === 'BESTAETIGT');
  check('F3+F5 BESTAETIGT→ZURUECKGEWIESEN→OFFEN', (await svc.zurueckweisen(periode, region, vl, 'Annahmen prüfen')).status === 'OFFEN');

  // Schwellwert-Anpassung
  const ver = await prisma.forecastVersion.findFirstOrThrow({ where: { periode, regionCode: region }, orderBy: { version: 'desc' } });
  const mw = ver.monatswerteRest as Record<string, { eur: number; units?: number | null }>;
  const breach = Object.fromEntries(Object.entries(mw).map(([k, v]) => [k, { eur: (v.eur || 1000) * 2 + 5000, units: v.units }]));
  const zelle = { landId: ver.landId, e1Id: ver.e1Id, monatswerteRest: breach };
  await expectStatus('F2 Anpassen >Schwellwert OHNE Kommentar → 422', 422, () => svc.anpassen(periode, region, agm, { zellen: [zelle] }));
  const r3 = await svc.anpassen(periode, region, agm, { kommentar: 'Großauftrag Q3', zellen: [zelle] });
  check('F2 OFFEN→ANGEPASST mit Pflichtkommentar', r3.status === 'ANGEPASST' && r3.schwellwertVerletzt === true);

  await expectStatus('Bestätigen aus ANGEPASST → 409 (kein Übergang)', 409, () => svc.bestaetigen(periode, region, agm));
  check('F7 ANGEPASST→ABGESCHLOSSEN (SYSTEM)', (await svc.abschliessen(periode, region, system)).status === 'ABGESCHLOSSEN');
  await expectStatus('Bestätigen nach ABGESCHLOSSEN → 409 (terminal)', 409, () => svc.bestaetigen(periode, region, agm));

  let blocked = false;
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM forecast_version WHERE periode='${periode}' AND "regionCode"='${region}'`);
  } catch {
    blocked = true;
  }
  check('forecast_version-Löschung blockiert (append-only P0001)', blocked);

  // jede Transition = neue Version (append-only): mehrere Versionen je Zelle
  const maxV = await prisma.forecastVersion.aggregate({ where: { periode, regionCode: region, landId: ver.landId, e1Id: ver.e1Id }, _max: { version: true } });
  check('append-only: mehrere Versionen je Zelle', (maxV._max.version ?? 0) >= 5);

  await app.close();
  if (fails.length) {
    console.error(`\n${fails.length} FEHLGESCHLAGEN:`, fails);
    process.exit(1);
  }
  console.log('\nALLE FORECAST-WORKFLOW-ASSERTIONS BESTANDEN ✓');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
