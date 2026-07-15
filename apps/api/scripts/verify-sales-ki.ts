import 'dotenv/config';
process.env.LLM_PROVIDER = 'mock'; // deterministischer Router, kein echter API-Key nötig
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SalesKiService } from '../src/sales-ki/sales-ki.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const svc = app.get(SalesKiService);

  if ((await prisma.verkaufsrechnungsposition.count()) === 0) {
    console.error('Keine Rechnungspositionen — bitte zuerst verify:sales-import laufen lassen.');
    process.exit(1);
  }

  const fails: string[] = [];
  const check = (n: string, c: boolean, extra?: unknown): void => {
    console.log(`${c ? '✓' : '✗'} ${n}${extra !== undefined ? `  (${JSON.stringify(extra)})` : ''}`);
    if (!c) fails.push(n);
  };

  const a1 = await svc.beantworte('Welche Kunden zahlen seit über 3 Jahren den gleichen Preis?');
  check('Preisfrage -> preisstabilitaet mit Treffern', a1.analyseTyp === 'preisstabilitaet' && (a1.ergebnis?.zeilen.length ?? 0) > 0, { antwort: a1.antwort });

  const a2 = await svc.beantworte('Wer hat den größten Umsatzrückgang von 2020 zu 2025?');
  check('Rückgangsfrage -> umsatzveraenderung rueckgang', a2.analyseTyp === 'umsatzveraenderung' && a2.ergebnis?.parameter.richtung === 'rueckgang' && (a2.ergebnis?.zeilen[0] as { deltaEur: number })?.deltaEur < 0, { antwort: a2.antwort });

  const a3 = await svc.beantworte('Zeig mir die größte Umsatzsteigerung von 2020 auf 2025');
  check('Steigerungsfrage -> umsatzveraenderung steigerung', a3.analyseTyp === 'umsatzveraenderung' && a3.ergebnis?.parameter.richtung === 'steigerung' && (a3.ergebnis?.zeilen[0] as { deltaEur: number })?.deltaEur > 0, { antwort: a3.antwort });

  const a4 = await svc.beantworte('Größte Mengenveränderung je Produkt von 2020 zu 2025');
  check('Mengenfrage -> mengentrend produkt', a4.analyseTyp === 'mengentrend' && a4.ergebnis?.parameter.dimension === 'produkt' && (a4.ergebnis?.zeilen.length ?? 0) > 0, { antwort: a4.antwort });

  const a5 = await svc.beantworte('Umsatzentwicklung des Kunden BEBIG über die Jahre');
  check('Kundenfrage -> kundenzeitreihe, Kunde aufgelöst', a5.analyseTyp === 'kundenzeitreihe' && !!a5.ergebnis && (a5.ergebnis?.zeilen.length ?? 0) >= 2, { aufloesung: a5.aufloesung, antwort: a5.antwort });

  const a6 = await svc.beantworte('Wie ist das Wetter morgen?');
  check('Fremdfrage -> unbekannt, kein Ergebnis', a6.analyseTyp === 'unbekannt' && a6.ergebnis === null);

  const a7 = await svc.beantworte('Umsatzentwicklung des Kunden GIBTESGARNICHT über die Jahre');
  check('Unbekannter Kunde -> Hinweis, kein Ergebnis', a7.analyseTyp === 'kundenzeitreihe' && a7.ergebnis === null && /nicht gefunden/.test(String(a7.aufloesung.kunde)), { antwort: a7.antwort });

  await app.close();
  if (fails.length) {
    console.error(`\n${fails.length} FEHLGESCHLAGEN:`, fails);
    process.exit(1);
  }
  console.log('\nALLE SALES-KI-ASSERTIONS BESTANDEN ✓');
}

main().catch((e) => { console.error(e); process.exit(1); });
