import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CustomerSiteService } from '../src/customer-site/customer-site.service';
import type { RequestUser } from '../src/common/decorators/current-user.decorator';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const svc = app.get(CustomerSiteService);

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

  // Ausgangszustand säubern (auch Reste früherer Läufe).
  await prisma.absatz.deleteMany({ where: { importBatch: { dateiname: 'verify-cs.csv' } } });
  await prisma.importBatch.deleteMany({ where: { dateiname: 'verify-cs.csv' } });
  await prisma.customerSite.deleteMany({ where: { name: { in: ['Hospital La Paz', 'Hospital La Paz Madrid', 'Clinica Verify XYZ', 'VERIFY-Fremd'] } } });

  const regionen = await prisma.region.findMany({ where: { forecastRelevant: true }, orderBy: { code: 'asc' } });
  if (regionen.length < 2) throw new Error('Test braucht >= 2 forecast-relevante Regionen.');
  const region = regionen[0];
  const fremd = regionen[1];
  const land = await prisma.land.findFirstOrThrow();

  const agm = await prisma.user.upsert({
    where: { email: 'verify-cs-agm@local.test' },
    update: {},
    create: { email: 'verify-cs-agm@local.test', name: 'CS AGM', rolle: 'AGM', status: 'VERIFIZIERT' },
  });
  await prisma.regionsVerantwortung.deleteMany({ where: { userId: agm.id } });
  await prisma.regionsVerantwortung.create({ data: { userId: agm.id, regionCode: region.code, gueltigVon: new Date('2020-01-01') } });
  const agmAktor: RequestUser = { id: agm.id, email: agm.email, rolle: 'AGM' };

  const siteIds = new Set<string>();
  const track = <T extends { id: string }>(s: T): T => {
    siteIds.add(s.id);
    return s;
  };

  // ── CRUD + Scoping ──
  const s1 = track(await svc.erstellen({ name: 'Hospital La Paz', stadt: 'Madrid', landIso: 'ES', regionCode: region.code, typ: 'OEFFENTLICH' }, adminAktor));
  check('Standort anlegen (Status NEU, Typ OEFFENTLICH)', s1.status === 'NEU' && s1.typ === 'OEFFENTLICH');
  const sFremd = track(await svc.erstellen({ name: 'VERIFY-Fremd', regionCode: fremd.code }, adminAktor));

  const agmSicht = (await svc.liste(agmAktor)).filter((s) => siteIds.has(s.id));
  check('AGM sieht nur Standorte der eigenen Region', agmSicht.length === 1 && agmSicht[0]?.id === s1.id);
  check('AGM holen() auf fremden Standort -> abgelehnt', await wirft(() => svc.holen(sFremd.id, agmAktor)));

  // ── Status-Workflow ──
  const sg = await svc.statusSetzen(s1.id, 'GEFAEHRDET', agmAktor);
  check('AGM setzt Status der eigenen Region (GEFAEHRDET)', sg.status === 'GEFAEHRDET');
  check('AGM Status fremd -> abgelehnt (Scope)', await wirft(() => svc.statusSetzen(sFremd.id, 'VERLOREN', agmAktor)));

  // ── Whitelist-PATCH ──
  const su = await svc.aktualisieren(s1.id, { stadt: 'Barcelona' }, adminAktor);
  check('Update ändert nur gesendetes Feld (Name unverändert)', su.stadt === 'Barcelona' && su.name === 'Hospital La Paz');

  // ── Fuzzy-Match-Bestätigung: temporäre Absatz-Daten ──
  const batch = await prisma.importBatch.create({ data: { typ: 'ABSATZ', dateiname: 'verify-cs.csv', hash: 'verify-cs', ausgeloestVonId: admin.id } });
  const basis = { jahr: 2099, bisMonat: 12, landId: land.isoCode, seeds: 0, seedsVorjahr: 0, ruthen: 0, ruthenVorjahr: 0, icTotal: 0, isTotal: 0, s16: 0, s16Vorjahr: 0, details: {}, importBatchId: batch.id };
  await prisma.absatz.create({ data: { ...basis, kunde: 'Hospital La Paz Madrid', stadt: 'Madrid', regionCode: region.code } });
  await prisma.absatz.create({ data: { ...basis, kunde: 'Clinica Verify XYZ', regionCode: null } });

  const vor = await svc.vorschlaege(10000);
  const vLaPaz = vor.vorschlaege.find((v) => v.kunde === 'Hospital La Paz Madrid');
  const vXyz = vor.vorschlaege.find((v) => v.kunde === 'Clinica Verify XYZ');
  check('Vorschlag: unzugeordneter Kunde matcht bestehenden Standort', !!vLaPaz && vLaPaz.matches.some((m) => m.id === s1.id));
  check('Vorschlag: Kunde ohne Treffer hat leere Match-Liste', !!vXyz && vXyz.matches.length === 0);
  check('Vorschlag: Region-Vorschlag aus Absatz übernommen', vLaPaz?.regionVorschlag === region.code);

  // Bestehendem zuordnen (+ idempotent)
  const zug = await svc.zuordnen({ kunde: 'Hospital La Paz Madrid', zielSiteId: s1.id }, adminAktor);
  check('Zuordnen zu bestehendem Standort (quellName ergänzt)', zug.quellNamen.includes('Hospital La Paz Madrid'));
  const nach = await svc.vorschlaege(10000);
  check('Zugeordneter Kunde verschwindet aus Vorschlägen', !nach.vorschlaege.some((v) => v.kunde === 'Hospital La Paz Madrid'));
  const zug2 = await svc.zuordnen({ kunde: 'Hospital La Paz Madrid', zielSiteId: s1.id }, adminAktor);
  check('Zuordnen idempotent (kein Duplikat im quellName)', zug2.quellNamen.filter((q) => q === 'Hospital La Paz Madrid').length === 1);

  // Neu anlegen aus Vorschlag
  const neu = track(await svc.zuordnen({ kunde: 'Clinica Verify XYZ', regionCode: region.code }, adminAktor));
  check('Zuordnen als NEUER Standort (Name=Kunde, quellName gesetzt, Status NEU, Region)', neu.name === 'Clinica Verify XYZ' && neu.quellNamen.includes('Clinica Verify XYZ') && neu.status === 'NEU' && neu.regionCode === region.code);

  // ── Löschen ──
  await svc.loeschen(sFremd.id, adminAktor);
  check('Löschen entfernt Standort', (await prisma.customerSite.findUnique({ where: { id: sFremd.id } })) === null);

  // ── Cleanup ──
  await prisma.absatz.deleteMany({ where: { importBatchId: batch.id } });
  await prisma.importBatch.delete({ where: { id: batch.id } });
  await prisma.customerSite.deleteMany({ where: { id: { in: [...siteIds] } } });
  await prisma.regionsVerantwortung.deleteMany({ where: { userId: agm.id } });
  await prisma.user.delete({ where: { id: agm.id } });

  await app.close();
  if (fails.length) {
    console.error(`\n${fails.length} FEHLGESCHLAGEN:`, fails);
    process.exit(1);
  }
  console.log('\nALLE CUSTOMER-SITE-ASSERTIONS BESTANDEN ✓');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
