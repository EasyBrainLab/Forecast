import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenderService } from '../src/tender/tender.service';
import { TenderScheduler } from '../src/tender/tender.scheduler';
import { CompetitorController } from '../src/competitor/competitor.controller';
import type { RequestUser } from '../src/common/decorators/current-user.decorator';

const TAG_MS = 24 * 60 * 60 * 1000;
const inTagen = (n: number): string => new Date(Date.now() + n * TAG_MS).toISOString();

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const tender = app.get(TenderService);
  const scheduler = app.get(TenderScheduler);
  const competitorCtrl = app.get(CompetitorController);

  const admin = await prisma.user.findFirstOrThrow({ where: { rolle: 'ADMIN' } });
  const adminAktor: RequestUser = { id: admin.id, email: admin.email, rolle: 'ADMIN' };

  const fails: string[] = [];
  const check = (n: string, c: boolean): void => {
    console.log(`${c ? '✓' : '✗'} ${n}`);
    if (!c) fails.push(n);
  };
  const wirft = async (fn: () => Promise<unknown>): Promise<boolean> => {
    try {
      await fn();
      return false;
    } catch {
      return true;
    }
  };

  // Sauberer Ausgangszustand + temporärer AGM mit genau EINER Region.
  await prisma.tender.deleteMany({ where: { referenznummer: { startsWith: 'VERIFY-' } } });
  const regionen = await prisma.region.findMany({ where: { forecastRelevant: true }, orderBy: { code: 'asc' } });
  if (regionen.length < 2) throw new Error('Test braucht >= 2 forecast-relevante Regionen.');
  const region = regionen[0];
  const fremdRegion = regionen[1];

  const agm = await prisma.user.upsert({
    where: { email: 'verify-tender-agm@local.test' },
    update: {},
    create: { email: 'verify-tender-agm@local.test', name: 'Verify Tender AGM', rolle: 'AGM', status: 'VERIFIZIERT' },
  });
  await prisma.regionsVerantwortung.deleteMany({ where: { userId: agm.id } });
  await prisma.regionsVerantwortung.create({ data: { userId: agm.id, regionCode: region.code, gueltigVon: new Date('2020-01-01') } });
  const agmAktor: RequestUser = { id: agm.id, email: agm.email, rolle: 'AGM' };

  // ── Erstellen + Lose ──
  const t1 = await tender.erstellen(
    { referenznummer: 'VERIFY-A', krankenhaus: 'Klinik A', abgabefrist: inTagen(60), lose: [{ bezeichnung: 'Los 1', volumenEur: 100000, menge: 50 }, { bezeichnung: 'Los 2', volumenEur: 50000, menge: 20 }] },
    adminAktor,
  );
  check('Admin erstellt Tender (Status BEOBACHTET)', t1.status === 'BEOBACHTET');
  check('Lose gespeichert (2 Stück, Volumen-Summe 150.000)', t1.lose.length === 2 && t1.lose.reduce((s, l) => s + (l.volumenEur ?? 0), 0) === 150000);

  // ── Pflicht- und Scope-Regeln beim Erstellen ──
  check('AGM ohne Region -> abgelehnt (Pflicht)', await wirft(() => tender.erstellen({ referenznummer: 'VERIFY-X', krankenhaus: 'K', abgabefrist: inTagen(60) }, agmAktor)));
  check('AGM mit fremder Region -> abgelehnt (Scope)', await wirft(() => tender.erstellen({ referenznummer: 'VERIFY-X', krankenhaus: 'K', abgabefrist: inTagen(60), regionCode: fremdRegion.code }, agmAktor)));
  check('Erstellen ohne Abgabefrist -> abgelehnt', await wirft(() => tender.erstellen({ referenznummer: 'VERIFY-X', krankenhaus: 'K' } as never, adminAktor)));

  const tAgm = await tender.erstellen({ referenznummer: 'VERIFY-AGM', krankenhaus: 'Klinik Eigen', abgabefrist: inTagen(60), regionCode: region.code }, agmAktor);
  check('AGM erstellt Tender in eigener Region', tAgm.regionCode === region.code);
  const tFremd = await tender.erstellen({ referenznummer: 'VERIFY-FREMD', krankenhaus: 'Klinik Fremd', abgabefrist: inTagen(60), regionCode: fremdRegion.code }, adminAktor);

  // ── Scoping beim Lesen (fail-closed) ──
  const agmSicht = (await tender.liste(agmAktor)).filter((t) => t.referenznummer.startsWith('VERIFY-'));
  check('AGM sieht nur Tender der eigenen Region', agmSicht.length > 0 && agmSicht.every((t) => t.regionCode === region.code));
  check('AGM sieht regionslosen/fremden Tender NICHT', !agmSicht.some((t) => t.id === t1.id || t.id === tFremd.id));
  const adminSicht = (await tender.liste(adminAktor)).filter((t) => t.referenznummer.startsWith('VERIFY-'));
  check('Admin sieht alle Tender (regionslos + fremd + eigen)', adminSicht.some((t) => t.id === t1.id) && adminSicht.some((t) => t.id === tFremd.id) && adminSicht.some((t) => t.id === tAgm.id));
  check('AGM holen() auf fremden Tender -> abgelehnt', await wirft(() => tender.holen(tFremd.id, agmAktor)));

  // ── Statusfilter ──
  const nurBeobachtet = await tender.liste(adminAktor, 'BEOBACHTET');
  check('Statusfilter greift (nur BEOBACHTET)', nurBeobachtet.every((t) => t.status === 'BEOBACHTET'));

  // ── Status setzen + Audit ──
  const auditVor = await prisma.auditTrail.count({ where: { entitaet: 'Tender', aktion: 'STATUS_WECHSEL' } });
  const t1g = await tender.statusSetzen(t1.id, 'GEWONNEN', adminAktor);
  const auditNach = await prisma.auditTrail.count({ where: { entitaet: 'Tender', aktion: 'STATUS_WECHSEL' } });
  check('Status auf GEWONNEN gesetzt + Audit geschrieben', t1g.status === 'GEWONNEN' && auditNach === auditVor + 1);

  // ── Whitelist-PATCH: nur gesendete Felder ändern ──
  const t1u = await tender.aktualisieren(t1.id, { krankenhaus: 'Klinik A – NEU' }, adminAktor);
  check('Update ändert nur gesendetes Feld (referenznummer unverändert)', t1u.krankenhaus === 'Klinik A – NEU' && t1u.referenznummer === 'VERIFY-A');

  // ── Frist-Update setzt Reminder-Schwelle zurück ──
  await prisma.tender.update({ where: { id: tAgm.id }, data: { reminderSchwelleTage: 7 } });
  await tender.aktualisieren(tAgm.id, { abgabefrist: inTagen(45) }, agmAktor);
  const nachFrist = await prisma.tender.findUniqueOrThrow({ where: { id: tAgm.id } });
  check('Friständerung setzt reminderSchwelleTage auf null zurück', nachFrist.reminderSchwelleTage === null);

  // ── Scheduler-Verdrahtung: Frist in 5 Tagen -> Schwelle 7 nach Lauf ──
  const tBald = await tender.erstellen({ referenznummer: 'VERIFY-BALD', krankenhaus: 'Fristnah', abgabefrist: inTagen(5) }, adminAktor);
  await scheduler.fristenCheck();
  const nachLauf = await prisma.tender.findUniqueOrThrow({ where: { id: tBald.id } });
  check('Scheduler setzt Reminder-Schwelle auf 7 (Frist in 5 Tagen)', nachLauf.reminderSchwelleTage === 7);
  // Zweiter Lauf ist idempotent (keine erneute Absenkung ohne neue Stufe).
  await scheduler.fristenCheck();
  const nachLauf2 = await prisma.tender.findUniqueOrThrow({ where: { id: tBald.id } });
  check('Zweiter Scheduler-Lauf ist idempotent (bleibt 7)', nachLauf2.reminderSchwelleTage === 7);

  // ── Löschen + Cascade der Lose ──
  const loseVor = await prisma.tenderLos.count({ where: { tenderId: t1.id } });
  await tender.loeschen(t1.id, adminAktor);
  const loseNach = await prisma.tenderLos.count({ where: { tenderId: t1.id } });
  const weg = await prisma.tender.findUnique({ where: { id: t1.id } });
  check('Löschen entfernt Tender + Lose (Cascade)', weg === null && loseVor === 2 && loseNach === 0);

  // ── Competitor-Stammliste (R2): CRUD + aktiv-Filter ──
  await prisma.competitor.deleteMany({ where: { name: { startsWith: 'VERIFY-' } } });
  const aktivSeed = await competitorCtrl.liste('true');
  check('Wettbewerber-Stammliste geseedet (>= 6 aktiv)', Array.isArray(aktivSeed) && aktivSeed.length >= 6);
  const wb = await competitorCtrl.erstellen({ name: 'VERIFY-WB' }, adminAktor);
  check('Wettbewerber anlegen (aktiv)', wb.name === 'VERIFY-WB' && wb.aktiv === true);
  await competitorCtrl.patch(wb.id, { aktiv: false }, adminAktor);
  const nurAktiv = await competitorCtrl.liste('true');
  const alle = await competitorCtrl.liste();
  check('Deaktivierter fehlt in nurAktiv, bleibt in Gesamtliste', !nurAktiv.some((c) => c.id === wb.id) && alle.some((c) => c.id === wb.id));
  await competitorCtrl.loeschen(wb.id, adminAktor);
  const alleFinal = await competitorCtrl.liste();
  check('Wettbewerber löschen', !alleFinal.some((c) => c.id === wb.id));

  // ── Cleanup ──
  await prisma.tender.deleteMany({ where: { referenznummer: { startsWith: 'VERIFY-' } } });
  await prisma.competitor.deleteMany({ where: { name: { startsWith: 'VERIFY-' } } });
  await prisma.regionsVerantwortung.deleteMany({ where: { userId: agm.id } });
  await prisma.user.delete({ where: { id: agm.id } });

  await app.close();
  if (fails.length) {
    console.error(`\n${fails.length} FEHLGESCHLAGEN:`, fails);
    process.exit(1);
  }
  console.log('\nALLE TENDER- + WETTBEWERBER-ASSERTIONS BESTANDEN ✓');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
