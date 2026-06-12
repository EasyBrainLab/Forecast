import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AbsatzService } from '../src/absatz/absatz.service';
import { AbsatzImportService, parsePeriodeAusDateiname } from '../src/absatz/absatz-import.service';
import { KundeRegionService } from '../src/absatz/kunde-region.service';
import { AgmStatementService } from '../src/agm-statement/agm-statement.service';
import { SalesFlashService } from '../src/sales-flash/sales-flash.service';
import type { RequestUser } from '../src/common/decorators/current-user.decorator';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const absatz = app.get(AbsatzService);
  const absImport = app.get(AbsatzImportService);
  const kundeRegion = app.get(KundeRegionService);
  const statements = app.get(AgmStatementService);
  const salesFlash = app.get(SalesFlashService);

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

  // ── P3: Sales-Flash + Reconciliation ──
  const pdf = Buffer.from('%PDF-1.4\n% verify dummy\n');
  await salesFlash.upload(pdf, 'verify_flash.pdf', 'application/pdf', 2026, 5, adminAktor);
  const recon0 = await salesFlash.reconciliation(2026, 5);
  check('Reconciliation: Beleg vorhanden, Tool-Ist berechnet', recon0.belegVorhanden && recon0.zeilen.length > 0);

  const istGesamt = recon0.gesamt.toolIst;
  await salesFlash.setActuals(2026, 5, { total: Math.round(istGesamt * 1.024), regionen: [] }, 'Verify: breitere Abgrenzung', adminAktor);
  const recon1 = await salesFlash.reconciliation(2026, 5);
  check('Reconciliation: Delta berechnet nach Actuals-Erfassung', recon1.gesamt.deltaEur !== null && Math.abs((recon1.gesamt.deltaEur ?? 0) - (recon1.gesamt.controllingActual! - recon1.gesamt.toolIst)) < 1);
  console.log(`  Tool-Ist ${recon1.gesamt.toolIst} | Controlling ${recon1.gesamt.controllingActual} | Delta ${recon1.gesamt.deltaEur} (${recon1.gesamt.deltaProzent}%)`);

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
