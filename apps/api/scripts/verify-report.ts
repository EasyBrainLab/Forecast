import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ReportService } from '../src/report/report.service';
import type { RequestUser } from '../src/common/decorators/current-user.decorator';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const svc = app.get(ReportService);

  const admin = await prisma.user.findFirstOrThrow({ where: { rolle: 'ADMIN' } });
  const adminAktor: RequestUser = { id: admin.id, email: admin.email, rolle: 'ADMIN' };

  const fails: string[] = [];
  const check = (n: string, c: boolean): void => {
    console.log(`${c ? '✓' : '✗'} ${n}`);
    if (!c) fails.push(n);
  };
  const wirft = async (fn: () => Promise<unknown>): Promise<string | null> => {
    try {
      await fn();
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };

  const periode = '2098-05';
  const regionen = await prisma.region.findMany({ where: { forecastRelevant: true }, orderBy: { code: 'asc' } });
  if (regionen.length < 2) throw new Error('Test braucht >= 2 forecast-relevante Regionen.');
  const region = regionen[0];
  const fremd = regionen[1];

  // Ausgangszustand + temporärer AGM + Stammdaten für Verknüpfungen.
  await prisma.monthlyReport.deleteMany({ where: { periode } });
  await prisma.customerSite.deleteMany({ where: { name: 'VERIFY-Report-Klinik' } });
  await prisma.competitor.deleteMany({ where: { name: 'VERIFY-Report-WB' } });
  const site = await prisma.customerSite.create({ data: { name: 'VERIFY-Report-Klinik', regionCode: region.code } });
  const wb = await prisma.competitor.create({ data: { name: 'VERIFY-Report-WB' } });
  const agm = await prisma.user.upsert({
    where: { email: 'verify-report-agm@local.test' },
    update: {},
    create: { email: 'verify-report-agm@local.test', name: 'Report AGM', rolle: 'AGM', status: 'VERIFIZIERT' },
  });
  await prisma.regionsVerantwortung.deleteMany({ where: { userId: agm.id } });
  await prisma.regionsVerantwortung.create({ data: { userId: agm.id, regionCode: region.code, gueltigVon: new Date('2020-01-01') } });
  const agmAktor: RequestUser = { id: agm.id, email: agm.email, rolle: 'AGM' };
  const vl = await prisma.user.upsert({
    where: { email: 'verify-report-vl@local.test' },
    update: {},
    create: { email: 'verify-report-vl@local.test', name: 'Report VL', rolle: 'VERTRIEBSLEITER', status: 'VERIFIZIERT' },
  });
  const vlAktor: RequestUser = { id: vl.id, email: vl.email, rolle: 'VERTRIEBSLEITER' };

  // ── Skeleton + Scoping ──
  const skel = await svc.fuerPeriode(periode, agmAktor);
  check('AGM sieht nur eigene Region im Skeleton', skel.regionen.length === 1 && skel.regionen[0]?.regionCode === region.code);
  const fremdFehler = await wirft(() => svc.speichernKopf(periode, fremd.code, { marktAllgemein: 'x' }, agmAktor));
  check('AGM schreibt fremde Region -> abgelehnt', fremdFehler !== null);

  // ── Kopf speichern (Whitelist) + Einträge ──
  await svc.speichernKopf(periode, region.code, { marktAllgemein: 'Markt stabil' }, agmAktor);
  const r1 = await svc.speichernKopf(periode, region.code, { forecastFolgemonatEur: 250000 }, agmAktor);
  check('Whitelist-PATCH: marktAllgemein bleibt bei Teil-Update erhalten', r1.marktAllgemein === 'Markt stabil' && r1.forecastFolgemonatEur === 250000);

  const mitKritisch = await svc.eintragAnlegen(periode, region.code, { abschnitt: 'KRITISCH', typ: 'PRODUKTPROBLEM', beschreibung: 'Chargenverzögerung', customerSiteId: site.id, e1Id: null }, agmAktor);
  check('Kritischer Eintrag mit Site-Verknüpfung (Name aufgelöst)', mitKritisch.eintraege.some((e) => e.abschnitt === 'KRITISCH' && e.customerSiteName === 'VERIFY-Report-Klinik'));

  const wbPflicht = await wirft(() => svc.eintragAnlegen(periode, region.code, { abschnitt: 'WETTBEWERB', beschreibung: 'ohne Wettbewerber' }, agmAktor));
  check('Wettbewerbs-Eintrag ohne Stammlisten-Wettbewerber -> abgelehnt', wbPflicht !== null && wbPflicht.includes('Stammliste'));

  await svc.eintragAnlegen(periode, region.code, { abschnitt: 'PROJEKT', beschreibung: 'Neues HDR-Projekt', landIso: 'ES', stadt: 'Madrid', erwarteterUmsatzEur: 120000, wahrscheinlichkeit: 60 }, agmAktor);
  await svc.eintragAnlegen(periode, region.code, { abschnitt: 'IMPLANTATION', beschreibung: 'Implantationen Mai', customerSiteId: site.id, menge: 14 }, agmAktor);

  // ── Pflichtprüfung beim Einreichen ──
  const fehlt = await wirft(() => svc.einreichen(periode, region.code, agmAktor));
  check('Einreichen blockiert: Quartals-Forecast + Wettbewerb fehlen', fehlt !== null && fehlt.includes('FORECAST_QUARTAL') && fehlt.includes('WETTBEWERB'));

  await svc.speichernKopf(periode, region.code, { forecastQuartalEur: 800000 }, agmAktor);
  await svc.eintragAnlegen(periode, region.code, { abschnitt: 'WETTBEWERB', beschreibung: 'Preisdruck im Süden', competitorId: wb.id, preisInfo: 'ca. -8%' }, agmAktor);
  const eingereicht = await svc.einreichen(periode, region.code, agmAktor);
  check('Einreichen mit vollständigen Pflichtabschnitten -> EINGEREICHT', eingereicht.status === 'EINGEREICHT' && eingereicht.eingereichtAm !== null);

  const gesperrt = await wirft(() => svc.speichernKopf(periode, region.code, { personal: 'x' }, agmAktor));
  check('Eingereichter Bericht ist gesperrt', gesperrt !== null);

  // ── Alternative Wettbewerbs-Pflicht: "keine Veränderung"-Flag ──
  await prisma.monthlyReport.deleteMany({ where: { periode: '2098-06' } });
  await svc.speichernKopf('2098-06', region.code, { forecastFolgemonatEur: 1, forecastQuartalEur: 2, wettbewerbKeineAenderung: true }, agmAktor);
  const flagOk = await svc.einreichen('2098-06', region.code, agmAktor);
  check('Einreichen mit Keine-Änderung-Flag statt Wettbewerbs-Eintrag', flagOk.status === 'EINGEREICHT');

  // ── Manager: Board + Lesebestätigung ──
  const board = await svc.board(periode, vlAktor);
  const zeile = board.regionen.find((r) => r.regionCode === region.code);
  check('Board zeigt EINGEREICHT für die Region', zeile?.status === 'EINGEREICHT');
  check('Board: Region ohne Bericht = FEHLT + überfällig (Frist 2098 längst vorbei? nein: Zukunft!)', board.regionen.some((r) => r.status === 'FEHLT' && r.ueberfaellig === false));
  const gelesen = await svc.gelesen(periode, region.code, vlAktor);
  check('Lesebestätigung VL -> GELESEN mit Leser', gelesen.status === 'GELESEN' && gelesen.gelesenVon === vl.email);

  // ── Wieder öffnen + Eintrag löschen ──
  const offen = await svc.zuruecksetzen(periode, region.code, agmAktor);
  check('Zurücksetzen -> ENTWURF (Lesebestätigung entfernt)', offen.status === 'ENTWURF' && offen.gelesenVon === null);
  const eintragId = offen.eintraege.find((e) => e.abschnitt === 'PROJEKT')?.id;
  const nachLoesch = await svc.eintragLoeschen(eintragId!, agmAktor);
  check('Eintrag löschen im Entwurf', !nachLoesch.eintraege.some((e) => e.id === eintragId));

  // ── Zahlensektion ──
  const zahlen = await svc.zahlen('2026-05', region.code, agmAktor);
  check('Zahlensektion liefert Produktlinien-Zeilen (Plan/Ist/YTD/PY)', zahlen.zeilen.length >= 3 && zahlen.zeilen.every((z) => typeof z.istYtd === 'number' && typeof z.planYtd === 'number'));
  const zahlenFremd = await wirft(() => svc.zahlen('2026-05', fremd.code, agmAktor));
  check('Zahlensektion fremde Region -> abgelehnt (AGM)', zahlenFremd !== null);

  // ── Cleanup ──
  await prisma.monthlyReport.deleteMany({ where: { periode: { in: [periode, '2098-06'] } } });
  await prisma.customerSite.delete({ where: { id: site.id } });
  await prisma.competitor.delete({ where: { id: wb.id } });
  await prisma.regionsVerantwortung.deleteMany({ where: { userId: agm.id } });
  await prisma.user.delete({ where: { id: agm.id } });
  await prisma.user.delete({ where: { id: vl.id } });

  await app.close();
  if (fails.length) {
    console.error(`\n${fails.length} FEHLGESCHLAGEN:`, fails);
    process.exit(1);
  }
  console.log('\nALLE REPORT-ASSERTIONS BESTANDEN ✓');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
