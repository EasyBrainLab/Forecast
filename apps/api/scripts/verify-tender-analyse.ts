import 'dotenv/config';
process.env.LLM_PROVIDER = 'mock';

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenderAnalyseService } from '../src/tender/tender-analyse.service';
import type { RequestUser } from '../src/common/decorators/current-user.decorator';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const svc = app.get(TenderAnalyseService);

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

  const region = (await prisma.region.findFirstOrThrow({ where: { forecastRelevant: true }, orderBy: { code: 'asc' } })).code;
  const agm = await prisma.user.upsert({
    where: { email: 'verify-ta-agm@local.test' },
    update: {},
    create: { email: 'verify-ta-agm@local.test', name: 'TA AGM', rolle: 'AGM', status: 'VERIFIZIERT' },
  });
  await prisma.regionsVerantwortung.deleteMany({ where: { userId: agm.id } });
  await prisma.regionsVerantwortung.create({ data: { userId: agm.id, regionCode: region, gueltigVon: new Date('2020-01-01') } });
  const agmAktor: RequestUser = { id: agm.id, email: agm.email, rolle: 'AGM' };
  await prisma.tenderDokument.deleteMany({ where: { hochgeladenVonId: agm.id } });
  await prisma.tender.deleteMany({ where: { referenznummer: 'ES-2099-TA' } });

  const doku = [
    'AUSSCHREIBUNG Hospital Test',
    'Referenznummer: ES-2099-TA',
    'Auftraggeber: Hospital Universitario Test',
    'Land: ES',
    'Abgabefrist: 2099-03-15',
    'Los 1: I-125 Seeds, 500 Stück, 120.000 EUR',
    'Gefordert: CE-Kennzeichnung, ISO 13485.',
  ].join('\n');

  // ── Upload (nur PDF/TXT) ──
  check('DOCX-Upload wird abgelehnt (Formathinweis)', await wirft(() => svc.upload(Buffer.from('x'), 'a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', region, agmAktor)));
  const d1 = await svc.upload(Buffer.from(doku, 'utf-8'), 'ausschreibung-test.txt', 'text/plain', region, agmAktor);
  check('Upload gespeichert (HOCHGELADEN, Original als Audit)', d1.status === 'HOCHGELADEN' && d1.groesseBytes > 0);

  // ── Analyse (Mock) + Guardrail ──
  const d2 = await svc.analysieren(d1.id, agmAktor);
  const a = d2.analyse!;
  check('Analyse: Referenz + Auftraggeber + Land erkannt', a.referenznummer === 'ES-2099-TA' && a.auftraggeber === 'Hospital Universitario Test' && a.landIso === 'ES');
  check('Analyse: Abgabefrist erkannt', a.abgabefrist === '2099-03-15');
  check('Analyse: Los mit Menge + Volumen', a.lose.length === 1 && a.lose[0]?.menge === 500 && a.lose[0]?.volumenEur === 120000);
  check('Analyse: Nachweis-Checkliste (CE/ISO)', a.nachweise.length >= 2);
  check('Analyse: Fragenkatalog vorhanden', a.fragen.length >= 1);
  check('ZAHLEN-GUARDRAIL: Frist + Mengen mit wörtlichem Kontext', a.zahlen.length >= 3 && a.zahlen.every((z) => z.pfad && z.kontext && doku.includes(z.kontext.slice(0, 12))));

  // ── Scoping: fremder AGM sieht/analysiert das Dokument nicht ──
  const fremd = await prisma.user.upsert({
    where: { email: 'verify-ta-agm2@local.test' },
    update: {},
    create: { email: 'verify-ta-agm2@local.test', name: 'TA AGM2', rolle: 'AGM', status: 'VERIFIZIERT' },
  });
  check('Fremder AGM -> abgelehnt', await wirft(() => svc.analysieren(d1.id, { id: fremd.id, email: fremd.email, rolle: 'AGM' })));

  // ── Übernahme -> Tender mit Frist/Losen + Dokument-Verknüpfung ──
  const { tender } = await svc.tenderAnlegen(d1.id, { regionCode: region }, agmAktor);
  check('Tender angelegt (Referenz, Frist, Region aus Analyse/Upload)', tender.referenznummer === 'ES-2099-TA' && tender.regionCode === region && new Date(tender.abgabefrist).toISOString().startsWith('2099-03-15'));
  check('Lose übernommen (500 Stk / 120.000 EUR)', tender.lose.length === 1 && tender.lose[0]?.menge === 500 && tender.lose[0]?.volumenEur === 120000);
  const dNach = await prisma.tenderDokument.findUniqueOrThrow({ where: { id: d1.id } });
  check('Dokument mit Tender verknüpft (UEBERNOMMEN)', dNach.tenderId === tender.id && dNach.status === 'UEBERNOMMEN');

  // ── Antwortentwurf (DOCX) ──
  const { dateiname, buffer } = await svc.antwortDocx(d1.id, [{ frage: 'Lieferzeit ab Bestellung?', antwortVorschlag: '10 Arbeitstage ab Bestelleingang', quelle: '§1' }], agmAktor);
  check('DOCX erzeugt (PK-Zip-Magic, > 5 kB, sprechender Name)', buffer.subarray(0, 2).toString() === 'PK' && buffer.length > 5000 && dateiname.includes('ES-2099-TA'));
  const inhaltXml = buffer.toString('latin1');
  check('DOCX ist echtes docx (word/document.xml enthalten)', inhaltXml.includes('word/document.xml'));

  // ── Cleanup ──
  await prisma.tenderDokument.deleteMany({ where: { hochgeladenVonId: agm.id } });
  await prisma.tender.deleteMany({ where: { referenznummer: 'ES-2099-TA' } });
  await prisma.regionsVerantwortung.deleteMany({ where: { userId: agm.id } });
  await prisma.user.deleteMany({ where: { id: { in: [agm.id, fremd.id] } } });

  await app.close();
  if (fails.length) {
    console.error(`\n${fails.length} FEHLGESCHLAGEN:`, fails);
    process.exit(1);
  }
  console.log('\nALLE TENDER-ANALYSE-ASSERTIONS BESTANDEN ✓');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
