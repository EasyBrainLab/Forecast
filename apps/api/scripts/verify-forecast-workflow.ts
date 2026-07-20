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
  const mk = async (email: string, rolle: 'AGM' | 'VERTRIEBSLEITER' | 'BU_LEITER'): Promise<RequestUser> => {
    const u = await prisma.user.create({ data: { email, name: email, rolle, status: 'VERIFIZIERT', passwortHash: 'x' } });
    return { id: u.id, email: u.email, rolle };
  };
  const admin: RequestUser = { id: adminRec.id, email: adminRec.email, rolle: 'ADMIN' };
  const system: RequestUser = { id: adminRec.id, email: 'SYSTEM', rolle: 'BU_LEITER' };
  const agm = await mk('agm@fc.test', 'AGM');
  const vl = await mk('vl@fc.test', 'VERTRIEBSLEITER');
  const bu = await mk('bu@fc.test', 'BU_LEITER');

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

  // Neuer Flow: Speichern (anpassen) ist ein Entwurf und hält die Periode OFFEN; eingereicht wird erst
  // über bestaetigen(). Werte über dem Monats-Schwellwert brauchen eine Monatsbegründung.
  const ver = await prisma.forecastVersion.findFirstOrThrow({ where: { periode, regionCode: region }, orderBy: { version: 'desc' } });
  const mw = ver.monatswerteRest as Record<string, { eur: number; units?: number | null }>;
  const breach = Object.fromEntries(Object.entries(mw).map(([k, v]) => [k, { eur: (v.eur || 1000) * 2 + 5000, units: v.units }]));
  const zelle = { landId: ver.landId, e1Id: ver.e1Id, monatswerteRest: breach };
  check('Speichern >Schwellwert ohne Begründung möglich (keine Pflicht mehr)', (await svc.anpassen(periode, region, agm, { monatsModus: true, zellen: [zelle] })).status === 'OFFEN');
  const pDraft = await prisma.forecastPeriode.findUniqueOrThrow({ where: { periode_regionCode: { periode, regionCode: region } } });
  check('Periode nach Speichern weiterhin OFFEN (editierbar)', pDraft.status === 'OFFEN');
  check('Mehrfaches Speichern möglich', (await svc.anpassen(periode, region, agm, { monatsModus: true, zellen: [zelle] })).status === 'OFFEN');
  const eingereicht = await svc.bestaetigen(periode, region, agm, 'Optionale Stellungnahme zum Q3-Forecast');
  check('Final bestätigen nach Anpassung → ANGEPASST', eingereicht.status === 'ANGEPASST' && eingereicht.angepasst === true);
  const finalVer = await prisma.forecastVersion.findFirstOrThrow({ where: { periode, regionCode: region }, orderBy: { version: 'desc' } });
  check('Optionale Stellungnahme in finaler Version gespeichert', finalVer.kommentar === 'Optionale Stellungnahme zum Q3-Forecast');
  await expectStatus('Speichern nach Einreichen → 409 (nicht mehr offen)', 409, () => svc.anpassen(periode, region, agm, { monatsModus: true, zellen: [zelle] }));
  await expectStatus('Abschließen als AGM → 403', 403, () => svc.abschliessen(periode, region, agm));
  check('F7 ANGEPASST→ABGESCHLOSSEN (SYSTEM)', (await svc.abschliessen(periode, region, system, { system: true })).status === 'ABGESCHLOSSEN');
  await expectStatus('Speichern nach ABGESCHLOSSEN → 409', 409, () => svc.anpassen(periode, region, agm, { monatsModus: true, zellen: [zelle] }));

  // F9 — Wiedereröffnung (Rollen + Pflicht-Begründung)
  await expectStatus('Wiedereröffnen als AGM → 403', 403, () => svc.wiederOeffnen(periode, region, agm, 'Korrektur'));
  await expectStatus('Wiedereröffnen ohne Begründung → 422', 422, () => svc.wiederOeffnen(periode, region, vl, '   '));
  const wo = await svc.wiederOeffnen(periode, region, vl, 'Nachmeldung Ist-Umsatz');
  const pWo = await prisma.forecastPeriode.findUniqueOrThrow({ where: { periode_regionCode: { periode, regionCode: region } } });
  check('F9 ABGESCHLOSSEN→OFFEN (VL, mit Begründung)', wo.status === 'OFFEN' && pWo.status === 'OFFEN' && pWo.abgeschlossenAm === null);
  check('AGM bestätigt nach Wiedereröffnung → ANGEPASST (Werte weiterhin angepasst)', (await svc.bestaetigen(periode, region, agm)).status === 'ANGEPASST');

  // Prozess 1: Zurücksetzen eines fertiggemeldeten Forecasts auf OFFEN durch die Leitung (BU-Leiter).
  await expectStatus('Zurücksetzen ohne Begründung → 422', 422, () => svc.zurueckweisen(periode, region, bu, '   '));
  check('Zurücksetzen ANGEPASST→OFFEN (BU-Leiter)', (await svc.zurueckweisen(periode, region, bu, 'AGM meldete versehentlich fertig')).status === 'OFFEN');
  check('AGM bestätigt erneut → ANGEPASST', (await svc.bestaetigen(periode, region, agm)).status === 'ANGEPASST');

  // Prozess 2: Fremdüberschreibung durch die Leitung (F10/F11) + Kenntnisnahme durch AGM.
  await expectStatus('Überschreiben ohne Begründung → 422', 422, () => svc.ueberschreiben(periode, region, vl, { zellen: [zelle], begruendung: '' }));
  await expectStatus('AGM darf nicht überschreiben → 403', 403, () => svc.ueberschreiben(periode, region, agm, { zellen: [zelle], begruendung: 'x' }));
  const ueb = await svc.ueberschreiben(periode, region, vl, { zellen: [zelle], begruendung: 'Managementkorrektur Q3' });
  const pUeb = await prisma.forecastPeriode.findUniqueOrThrow({ where: { periode_regionCode: { periode, regionCode: region } } });
  check('Leitung überschreibt fertiggemeldeten Forecast (→ANGEPASST, fremdmarkiert)', ueb.status === 'ANGEPASST' && pUeb.fremdaenderungAm !== null && pUeb.fremdaenderungVon === vl.email && pUeb.fremdaenderungQuittiertAm === null);
  check('Leitung überschreibt erneut (F11 ANGEPASST→ANGEPASST)', (await svc.ueberschreiben(periode, region, bu, { zellen: [zelle], begruendung: 'Nachkorrektur' })).status === 'ANGEPASST');
  await svc.quittieren(periode, region, agm);
  const pQ = await prisma.forecastPeriode.findUniqueOrThrow({ where: { periode_regionCode: { periode, regionCode: region } } });
  check('AGM nimmt Fremdüberschreibung zur Kenntnis', pQ.fremdaenderungQuittiertAm !== null);
  await expectStatus('Erneutes Quittieren ohne offene Fremdänderung → 400', 400, () => svc.quittieren(periode, region, agm));

  // Kaskade: 07 + 08 zusätzlich öffnen (Restmonate haben Budgetzeilen), dann nur die jüngste abschließen.
  await svc.oeffnePeriode('2026-07', region, admin);
  await svc.oeffnePeriode('2026-08', region, admin);
  const zu = await svc.abschliessen('2026-08', region, admin);
  const alleZu = await prisma.forecastPeriode.findMany({ where: { regionCode: region }, orderBy: [{ jahr: 'asc' }, { monat: 'asc' }] });
  check(
    'Kaskade abwärts: Abschluss 2026-08 schließt 06/07 mit',
    zu.abgeschlossen.join(',') === '2026-06,2026-07,2026-08' && alleZu.every((p) => p.status === 'ABGESCHLOSSEN'),
  );

  // Kaskade aufwärts: die älteste wieder öffnen -> jüngere gehen mit auf (keine Lücken).
  const auf = await svc.wiederOeffnen('2026-06', region, vl, 'Ist-Korrektur Juni');
  const alleAuf = await prisma.forecastPeriode.findMany({ where: { regionCode: region } });
  check(
    'Kaskade aufwärts: Wiedereröffnung 2026-06 öffnet 07/08 mit',
    auf.wiederGeoeffnet.sort().join(',') === '2026-06,2026-07,2026-08' &&
      alleAuf.every((p) => p.status === 'OFFEN' && p.abgeschlossenAm === null),
  );

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
