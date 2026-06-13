import 'dotenv/config';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AbsatzService } from '../src/absatz/absatz.service';
import { AbsatzImportService, parsePeriodeAusDateiname } from '../src/absatz/absatz-import.service';
import { KundeRegionService } from '../src/absatz/kunde-region.service';
import { AgmStatementService } from '../src/agm-statement/agm-statement.service';
import { SalesFlashService } from '../src/sales-flash/sales-flash.service';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { PeriodeService } from '../src/periode/periode.service';
import type { RequestUser } from '../src/common/decorators/current-user.decorator';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const absatz = app.get(AbsatzService);
  const absImport = app.get(AbsatzImportService);
  const kundeRegion = app.get(KundeRegionService);
  const statements = app.get(AgmStatementService);
  const salesFlash = app.get(SalesFlashService);
  const dashboard = app.get(DashboardService);
  const periodeSvc = app.get(PeriodeService);

  const admin = await prisma.user.findFirstOrThrow({ where: { rolle: 'ADMIN' } });
  const adminAktor: RequestUser = { id: admin.id, email: admin.email, rolle: 'ADMIN' };

  const fails: string[] = [];
  const check = (n: string, c: boolean): void => {
    console.log(`${c ? '✓' : '✗'} ${n}`);
    if (!c) fails.push(n);
  };

  // ── Vorbereitung: Absatz lokal importieren (für Scoping-Test) ──
  const datenDir = process.env.DATEN_DIR && process.env.DATEN_DIR !== '.' ? process.env.DATEN_DIR : join(__dirname, '../../..');
  const name = 'SF_01_05_2026_qty_by_Region.csv';
  const buffer = readFileSync(join(datenDir, 'docs', name));
  const periode = parsePeriodeAusDateiname(name)!;
  await absImport.importiere(buffer, name, periode, adminAktor);

  // ── P4: Kunde→Region-Mapping wirkt rückwirkend + Scoping ──
  const top = (await prisma.absatz.findFirst({ where: { jahr: 2026, bisMonat: 5 }, orderBy: { seeds: 'desc' }, select: { kunde: true } }))!;
  const region = await prisma.region.findFirstOrThrow({ where: { forecastRelevant: true } });
  const up = await kundeRegion.upsert(top.kunde, region.code, adminAktor);
  check(`KundeRegion.upsert ordnet Bestandszeilen zu (${up.zeilenAktualisiert} > 0)`, up.zeilenAktualisiert > 0);

  const kpiGesamt = await absatz.kpi(2026, 5, null);
  const kpiRegion = await absatz.kpi(2026, 5, [region.code]);
  check('Absatz-Scoping: Region-KPI <= Gesamt-KPI', kpiRegion.kennzahlen.seeds <= kpiGesamt.kennzahlen.seeds && kpiRegion.kennzahlen.seeds > 0);
  const kpiLeer = await absatz.kpi(2026, 5, []);
  check('Absatz-Scoping: leerer Scope -> 0 Seeds (fail-closed)', kpiLeer.kennzahlen.seeds === 0);

  // ── P2: AGM-Statement (temporärer AGM) ──
  const agm = await prisma.user.upsert({
    where: { email: 'verify-agm@local.test' },
    update: {},
    create: { email: 'verify-agm@local.test', name: 'Verify AGM', rolle: 'AGM', status: 'VERIFIZIERT' },
  });
  await prisma.regionsVerantwortung.deleteMany({ where: { userId: agm.id } });
  await prisma.regionsVerantwortung.create({ data: { userId: agm.id, regionCode: region.code, gueltigVon: new Date('2020-01-01') } });
  const agmAktor: RequestUser = { id: agm.id, email: agm.email, rolle: 'AGM' };
  const per = '2026-06';
  await prisma.agmStatement.deleteMany({ where: { periode: per, regionCode: region.code } });

  await statements.speichern(per, region.code, { abweichungGrund: 'MARKT', risiken: 'Testrisiko', actionItems: [{ beschreibung: 'Kunde X besuchen', faelligBis: '2026-07-01', erledigt: false }] }, agmAktor);
  const liste = await statements.fuerPeriode(per, agmAktor);
  const meinStatement = liste.regionen.find((r) => r.regionCode === region.code);
  check('Statement gespeichert (ENTWURF, Action-Item)', meinStatement?.statement?.status === 'ENTWURF' && (meinStatement?.statement?.actionItems.length ?? 0) === 1);

  let einreichenBlockiert = false;
  try {
    await statements.einreichen(per, region.code, agmAktor);
  } catch {
    einreichenBlockiert = true;
  }
  check('Einreichen ohne Abweichungskommentar wird blockiert (Pflichtfeld)', einreichenBlockiert);

  // Voll-Ersatz wie das Frontend (kompletter State inkl. Action-Items)
  await statements.speichern(per, region.code, { abweichungGrund: 'MARKT', abweichungKommentar: 'Markt schwächer als geplant', risiken: 'Testrisiko', actionItems: [{ beschreibung: 'Kunde X besuchen', faelligBis: '2026-07-01', erledigt: false }] }, agmAktor);
  const eingereicht = await statements.einreichen(per, region.code, agmAktor);
  check('Einreichen mit Kommentar -> EINGEREICHT', eingereicht.status === 'EINGEREICHT');

  let gesperrt = false;
  try {
    await statements.speichern(per, region.code, { risiken: 'darf nicht' }, agmAktor);
  } catch {
    gesperrt = true;
  }
  check('Eingereichtes Statement ist gesperrt', gesperrt);

  const offene = await statements.offeneActionItems(adminAktor);
  check('Offene Action-Items für BU sichtbar', offene.some((o) => o.beschreibung === 'Kunde X besuchen'));

  // ── P3: Sales-Flash + Reconciliation (echtes PDF durch den Auto-Parser) ──
  const flashPath = join(datenDir, 'docs', 'Sales Flash 2026_05_Total.pdf');
  const hatFlash = existsSync(flashPath);
  const pdf = hatFlash ? readFileSync(flashPath) : Buffer.from('%PDF-1.4\n% dummy\n');
  const flashUp = await salesFlash.upload(pdf, hatFlash ? 'Sales Flash 2026_05_Total.pdf' : 'dummy.pdf', 'application/pdf', 2026, 5, adminAktor);
  const recon0 = await salesFlash.reconciliation(2026, 5);
  check('Reconciliation: Beleg vorhanden, Tool-Ist berechnet', recon0.belegVorhanden && recon0.zeilen.length > 0);

  if (hatFlash) {
    check('Sales-Flash auto-ausgelesen (Total 7.667.781, 5 Regionen)', flashUp.autoAusgelesen && flashUp.total === 7667781 && flashUp.regionenErkannt === 5);
    check('Auto-Fill: EP-Actual = 1.379.298', recon0.zeilen.find((z) => z.regionCode === 'EP')?.controllingActual === 1379298);
    check('Auto-Fill: CS(Radiotherapy)-Actual = 2.182.627', recon0.zeilen.find((z) => z.regionCode === 'CS')?.controllingActual === 2182627);
    check('Reconciliation-Delta gesamt (Sales-Flash minus Tool-Ist)', Math.abs((recon0.gesamt.deltaEur ?? 0) - (7667781 - recon0.gesamt.toolIst)) < 1);
    console.log(`  Tool-Ist ${recon0.gesamt.toolIst} | Controlling ${recon0.gesamt.controllingActual} | Delta ${recon0.gesamt.deltaEur} (${recon0.gesamt.deltaProzent}%)`);
  } else {
    console.log('  (Sales-Flash-PDF nicht vorhanden — Auto-Parser-Test übersprungen)');
  }

  // ── K1: Wahrheits-Hierarchie (Konsolidierung nutzt Sales-Flash-Ist) ──
  if (hatFlash) {
    const konso = await dashboard.konsolidierung(2026, adminAktor);
    check('K1: Konsolidierung istQuelle = SALES_FLASH', konso.istQuelle === 'SALES_FLASH');
    check('K1: offizielle Ist-Summe = Sales-Flash-Total 7.667.781', Math.abs(konso.gesamt.istYtd - 7667781) < 1);
    const ep = konso.zeilen.find((z) => z.regionCode === 'EP');
    check('K1: EP-Ist = 1.379.298 (Quelle SALES_FLASH)', ep?.istYtd === 1379298 && ep?.istQuelle === 'SALES_FLASH');

    // ── K2: Monats-Status-Board ──
    await prisma.periodenAbschluss.deleteMany({ where: { jahr: 2026, monat: 5 } });
    const board = await periodeSvc.uebersicht(2026);
    const mai = board.monate.find((m) => m.monat === 5)!;
    check('K2: Mai hat alle 3 Quellen (GL+SalesFlash+Absatz)', mai.gl.vorhanden && mai.salesFlash.actualsErfasst && mai.absatz.vorhanden);
    check('K2: Mai-Ampel gelb (vollständig, nicht freigegeben)', mai.ampel === 'gelb');
    await periodeSvc.abschliessen(2026, 5, 'Verify-Abschluss', adminAktor);
    const board2 = await periodeSvc.uebersicht(2026);
    check('K2: nach Abschluss Mai-Ampel grün', board2.monate.find((m) => m.monat === 5)!.ampel === 'gruen');

    // ── K3: Cross-Source-Abgleich (EUR/Units/ASP/Budget) ──
    const det = await periodeSvc.detail(2026, 5);
    const epD = det.zeilen.find((z) => z.regionCode === 'EP')!;
    check('K3: EP Sales-Flash-Ist=1.379.298, Delta zu GL berechnet', epD.salesFlashIst === 1379298 && epD.deltaEur !== null);
    check('K3: Gesamt-Delta GL<->offiziell (~ +179.970)', Math.abs((det.gesamt.deltaEur ?? 0) - (7667781 - det.gesamt.glIst)) < 1);
    const mitUnits = det.zeilen.find((z) => z.units && z.units > 0);
    check('K3: ASP wird berechnet, wo Units zugeordnet', !!mitUnits && mitUnits.aspEur !== null);
    console.log(`  Detail Mai: GL ${det.gesamt.glIst} | offiziell ${det.gesamt.offiziellIst} | Units ${det.gesamt.units} | Budget ${det.gesamt.budget}`);

    await prisma.periodenAbschluss.deleteMany({ where: { jahr: 2026, monat: 5 } });
  }

  // ── Fix-Regressionen: #5 Absatz-Abbruch bei 0 validen Zeilen, #4 Re-Upload erhält manuelle Actuals ──
  const cntVor = await prisma.absatz.count({ where: { jahr: 2026, bisMonat: 5 } });
  let absatzAbort = false;
  try {
    await absImport.importiere(Buffer.from('Foo,Bar\n1,2\n'), 'SF_01_05_2026_kaputt.csv', periode, adminAktor);
  } catch {
    absatzAbort = true;
  }
  const cntNach = await prisma.absatz.count({ where: { jahr: 2026, bisMonat: 5 } });
  check('#5 Absatz-Import bricht bei 0 validen Zeilen ab, Periode bleibt erhalten', absatzAbort && cntVor > 0 && cntNach === cntVor);

  if (hatFlash) {
    await salesFlash.setActuals(2026, 5, { total: 9999999, regionen: [] }, 'manuell korrigiert', adminAktor);
    const reUp = await salesFlash.upload(pdf, 'Sales Flash 2026_05_Total.pdf', 'application/pdf', 2026, 5, adminAktor);
    check('#4 Re-Upload überschreibt manuelle Actuals NICHT', reUp.manuelleActualsBeibehalten === true && reUp.autoAusgelesen === false);
    const reconM = await salesFlash.reconciliation(2026, 5);
    check('#4 Reconciliation nutzt manuellen Total (9.999.999)', reconM.gesamt.controllingActual === 9999999);
  }

  // ── Cleanup temporärer Verify-Daten ──
  await prisma.agmStatement.deleteMany({ where: { periode: per, regionCode: region.code } });
  await prisma.regionsVerantwortung.deleteMany({ where: { userId: agm.id } });
  await prisma.user.delete({ where: { id: agm.id } });
  await prisma.salesFlashDokument.deleteMany({ where: { jahr: 2026, monat: 5 } });
  await kundeRegion.remove(top.kunde, adminAktor);

  await app.close();
  if (fails.length) {
    console.error(`\n${fails.length} FEHLGESCHLAGEN:`, fails);
    process.exit(1);
  }
  console.log('\nALLE ERWEITERUNGS-ASSERTIONS BESTANDEN ✓');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
