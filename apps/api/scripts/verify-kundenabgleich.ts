import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { KundenabgleichService } from '../src/kundenabgleich/kundenabgleich.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const svc = app.get(KundenabgleichService);

  const stammCount = await prisma.kundenstamm.count();
  if (stammCount === 0) {
    console.error('Kein Kundenstamm vorhanden — bitte zuerst verify:sales-import laufen lassen.');
    process.exit(1);
  }
  const admin = await prisma.user.findFirstOrThrow({ where: { rolle: 'ADMIN' } });
  const aktor = { id: admin.id, email: admin.email, rolle: 'ADMIN' as const };

  // Sauberer Ausgangszustand: D365-Verknüpfungen aller Sites zurücksetzen (nur d365Konten, quellNamen unberührt).
  await prisma.customerSite.updateMany({ data: { d365Konten: [] } });

  const fails: string[] = [];
  const check = (n: string, c: boolean, extra?: unknown): void => {
    console.log(`${c ? '✓' : '✗'} ${n}${extra !== undefined ? `  (${JSON.stringify(extra)})` : ''}`);
    if (!c) fails.push(n);
  };
  const expectStatus = async (n: string, code: number, fn: () => Promise<unknown>): Promise<void> => {
    try { await fn(); check(n, false); } catch (e) { check(n, (e as { status?: number }).status === code); }
  };

  const s0 = await svc.status();
  check('Status: kundenstammGesamt = 406', s0.kundenstammGesamt === 406, s0);
  check('Status: anfangs 0 verknüpft, alle offen', s0.verknuepft === 0 && s0.offen === s0.kundenstammGesamt);
  check('Status: rechnungskundenOhneStamm > 0 (die Altkonten)', s0.rechnungskundenOhneStamm > 0, { ohneStamm: s0.rechnungskundenOhneStamm, gesamt: s0.rechnungskundenGesamt });

  const v0 = await svc.vorschlaege();
  check('Vorschläge: alle offenen Kunden gelistet', v0.offenGesamt === s0.offen, { offenGesamt: v0.offenGesamt });
  const ziel = v0.vorschlaege[0];
  check('Vorschlag hat dataAreaId + kundennummer + name', !!ziel && !!ziel.dataAreaId && !!ziel.kundennummer && !!ziel.name, ziel && { da: ziel.dataAreaId, nr: ziel.kundennummer, name: ziel.name });

  // Neu anlegen (kein zielSiteId) -> neuer CustomerSite mit d365Konten
  const created = await svc.zuordnen({ dataAreaId: ziel.dataAreaId, kundennummer: ziel.kundennummer, regionCode: null }, aktor);
  const key = `${ziel.dataAreaId}|${ziel.kundennummer}`;
  check('Neu anlegen: CustomerSite mit d365Konto erstellt', created.d365Konten.includes(key) && created.name === ziel.name, { name: created.name, konten: created.d365Konten });

  const s1 = await svc.status();
  check('Status nach Zuordnung: verknüpft = 1, offen -1', s1.verknuepft === 1 && s1.offen === s0.offen - 1, { verknuepft: s1.verknuepft, offen: s1.offen });

  // Der zugeordnete Kunde taucht nicht mehr in den Vorschlägen auf
  const v1 = await svc.vorschlaege();
  check('Zugeordneter Kunde ist aus Vorschlägen verschwunden', !v1.vorschlaege.some((v) => v.dataAreaId === ziel.dataAreaId && v.kundennummer === ziel.kundennummer));

  // Zuordnen an bestehende Site (zielSiteId) — zweiter Kunde an dieselbe Site anhängen
  const ziel2 = v1.vorschlaege[0];
  const linked = await svc.zuordnen({ dataAreaId: ziel2.dataAreaId, kundennummer: ziel2.kundennummer, zielSiteId: created.id }, aktor);
  const key2 = `${ziel2.dataAreaId}|${ziel2.kundennummer}`;
  check('Zuordnen an bestehende Site: beide Konten verknüpft', linked.d365Konten.includes(key) && linked.d365Konten.includes(key2), linked.d365Konten);

  // Idempotenz: dieselbe Zuordnung erneut -> keine Dublette
  const linked2 = await svc.zuordnen({ dataAreaId: ziel2.dataAreaId, kundennummer: ziel2.kundennummer, zielSiteId: created.id }, aktor);
  check('Idempotenz: kein doppeltes Konto', linked2.d365Konten.filter((k) => k === key2).length === 1);

  // Unbekanntes Konto -> 404
  await expectStatus('Zuordnen unbekanntes Konto -> 404', 404, () => svc.zuordnen({ dataAreaId: 'XXX', kundennummer: 'GIBTESNICHT' }, aktor));

  // Rechnungskunden ohne Stamm
  const os = await svc.rechnungskundenOhneStamm();
  check('Rechnungskunden ohne Stamm: Liste + Anzahl > 0', os.gesamt > 0 && os.kunden.length > 0 && os.kunden[0].anzahlRechnungen > 0, { gesamt: os.gesamt, bsp: os.kunden[0] });

  await app.close();
  if (fails.length) {
    console.error(`\n${fails.length} FEHLGESCHLAGEN:`, fails);
    process.exit(1);
  }
  console.log('\nALLE KUNDENABGLEICH-ASSERTIONS BESTANDEN ✓');
}

main().catch((e) => { console.error(e); process.exit(1); });
