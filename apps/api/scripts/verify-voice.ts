import 'dotenv/config';
// E2E-Test des Diktat-Flows mit Mock-Providern (Auftrag: "E2E-Test für den Diktat-Flow mit Mock-STT").
process.env.STT_PROVIDER = 'mock';
process.env.LLM_PROVIDER = 'mock';

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { VoiceService } from '../src/voice/voice.service';
import type { RequestUser } from '../src/common/decorators/current-user.decorator';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const svc = app.get(VoiceService);

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

  const regionen = await prisma.region.findMany({ where: { forecastRelevant: true }, orderBy: { code: 'asc' } });
  const region = regionen[0];
  const fremd = regionen[1];
  const agm = await prisma.user.upsert({
    where: { email: 'verify-voice-agm@local.test' },
    update: {},
    create: { email: 'verify-voice-agm@local.test', name: 'Voice AGM', rolle: 'AGM', status: 'VERIFIZIERT' },
  });
  await prisma.regionsVerantwortung.deleteMany({ where: { userId: agm.id } });
  await prisma.regionsVerantwortung.create({ data: { userId: agm.id, regionCode: region.code, gueltigVon: new Date('2020-01-01') } });
  const agmAktor: RequestUser = { id: agm.id, email: agm.email, rolle: 'AGM' };
  await prisma.voiceSession.deleteMany({ where: { userId: agm.id } });
  const periode = '2097-05';
  await prisma.monthlyReport.deleteMany({ where: { periode } });

  // ── Status / Feature-Detection ──
  const status = await svc.status();
  check('Status: Diktat mit Mock-Providern verfügbar', status.verfuegbar && status.stt === 'mock' && status.llm === 'mock');

  // ── Upload -> Transkript (Mock-STT: Buffer = Transkript) ──
  const diktat = 'Forecast 250 tausend Euro für den Folgemonat. 14 Implantationen bei Klinik Musterstadt. Keine Veränderung beim Wettbewerb.';
  const s1 = await svc.upload(Buffer.from(diktat, 'utf-8'), 'text/plain', periode, region.code, 'de', agmAktor);
  check('Upload + Mock-STT liefert Transkript', s1.transkript === diktat && s1.status === 'TRANSKRIBIERT');
  check('Audio initial gespeichert', s1.audioGespeichert === true);

  // ── Scoping ──
  check('Upload für fremde Region -> abgelehnt', await wirft(() => svc.upload(Buffer.from('x'), 'text/plain', periode, fremd.code, 'de', agmAktor)));

  // ── Extraktion (Mock-LLM) + Zahlen-Guardrail ──
  const s2 = await svc.extrahieren(s1.id, agmAktor);
  const ex = s2.extraktion!;
  check('Extraktion liefert Kopf-Forecast (250.000)', ex.kopf.forecastFolgemonatEur === 250000);
  check('Extraktion liefert Implantations-Eintrag (menge 14)', ex.eintraege.some((e) => e.abschnitt === 'IMPLANTATION' && e.menge === 14));
  check('Keine-Änderung-Flag erkannt', ex.kopf.wettbewerbKeineAenderung === true);
  check('ZAHLEN-GUARDRAIL: jede Zahl mit Pfad + wörtlichem Kontext', ex.zahlen.length >= 2 && ex.zahlen.every((z) => z.pfad && z.kontext && diktat.toLowerCase().includes(z.kontext.toLowerCase().slice(0, 10))));

  // ── Bestätigen -> Audio-Löschung (Default SOFORT_LOESCHEN) ──
  await prisma.einstellung.upsert({ where: { key: 'AUDIO_AUFBEWAHRUNG' }, update: { value: 'SOFORT_LOESCHEN' }, create: { key: 'AUDIO_AUFBEWAHRUNG', value: 'SOFORT_LOESCHEN' } });
  const s3 = await svc.bestaetigen(s1.id, agmAktor);
  check('Bestätigt + Audio sofort gelöscht (Transkript bleibt)', s3.status === 'BESTAETIGT' && s3.audioGespeichert === false && s3.transkript === diktat);

  // ── Fremder AGM darf die Session nicht anfassen ──
  const fremderAgm = await prisma.user.upsert({
    where: { email: 'verify-voice-agm2@local.test' },
    update: {},
    create: { email: 'verify-voice-agm2@local.test', name: 'Voice AGM 2', rolle: 'AGM', status: 'VERIFIZIERT' },
  });
  await prisma.regionsVerantwortung.deleteMany({ where: { userId: fremderAgm.id } });
  await prisma.regionsVerantwortung.create({ data: { userId: fremderAgm.id, regionCode: region.code, gueltigVon: new Date('2020-01-01') } });
  check('Fremder AGM (gleiche Region) -> abgelehnt (nur eigenes Diktat)', await wirft(() => svc.extrahieren(s1.id, { id: fremderAgm.id, email: fremderAgm.email, rolle: 'AGM' })));

  // ── Verwerfen ──
  const s4 = await svc.upload(Buffer.from('Test verwerfen'), 'text/plain', periode, region.code, undefined, agmAktor);
  const s5 = await svc.verwerfen(s4.id, agmAktor);
  check('Verwerfen -> Status VERWORFEN + Audio weg', s5.status === 'VERWORFEN' && s5.audioGespeichert === false);

  // ── Retention-Job (TAGE_30) ──
  await prisma.einstellung.update({ where: { key: 'AUDIO_AUFBEWAHRUNG' }, data: { value: 'TAGE_30' } });
  const alt = await svc.upload(Buffer.from('Altes Diktat'), 'text/plain', periode, region.code, undefined, agmAktor);
  await prisma.voiceSession.update({ where: { id: alt.id }, data: { erstelltAm: new Date(Date.now() - 40 * 24 * 3600 * 1000) } });
  await svc.audioRetention();
  const altNach = await prisma.voiceSession.findUniqueOrThrow({ where: { id: alt.id } });
  check('Retention TAGE_30: Audio > 30 Tage gelöscht', altNach.audio === null);
  await prisma.einstellung.update({ where: { key: 'AUDIO_AUFBEWAHRUNG' }, data: { value: 'SOFORT_LOESCHEN' } });

  // ── Cleanup ──
  await prisma.voiceSession.deleteMany({ where: { userId: agm.id } });
  await prisma.monthlyReport.deleteMany({ where: { periode } });
  await prisma.regionsVerantwortung.deleteMany({ where: { userId: { in: [agm.id, fremderAgm.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [agm.id, fremderAgm.id] } } });

  await app.close();
  if (fails.length) {
    console.error(`\n${fails.length} FEHLGESCHLAGEN:`, fails);
    process.exit(1);
  }
  console.log('\nALLE VOICE-ASSERTIONS BESTANDEN ✓');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
