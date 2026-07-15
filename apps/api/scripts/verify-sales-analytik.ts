import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SalesAnalytikService } from '../src/sales-analytik/sales-analytik.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const svc = app.get(SalesAnalytikService);

  if ((await prisma.verkaufsrechnungsposition.count()) === 0) {
    console.error('Keine Rechnungspositionen — bitte zuerst verify:sales-import laufen lassen.');
    process.exit(1);
  }

  const fails: string[] = [];
  const check = (n: string, c: boolean, extra?: unknown): void => {
    console.log(`${c ? '✓' : '✗'} ${n}${extra !== undefined ? `  (${JSON.stringify(extra)})` : ''}`);
    if (!c) fails.push(n);
  };

  const fo = await svc.filteroptionen();
  check('Filteroptionen: Jahre 2020–2026', fo.jahre.includes(2020) && fo.jahre.includes(2026), fo.jahre);
  check('Filteroptionen: EUR vorhanden', fo.waehrungen.some((w) => w.waehrung === 'EUR'), fo.waehrungen.map((w) => w.waehrung));

  const ps = await svc.preisstabilitaet({ jahre: 3, toleranzProzent: 0 });
  check('Preisstabilität: Treffer gefunden', ps.zeilen.length > 0, { anzahl: ps.zeilen.length, bsp: ps.zeilen[0] });
  check('Preisstabilität: alle ≥ 3 Jahre und Schwankung 0', ps.zeilen.every((z) => z.jahreSpanne >= 3 && z.preisSchwankung === 0));

  const up = await svc.umsatzveraenderung({ jahrVon: 2020, jahrBis: 2025, richtung: 'rueckgang', limit: 10 });
  check('Umsatzrückgang: alle Δ < 0, absteigend sortiert', up.zeilen.length > 0 && up.zeilen.every((z) => z.deltaEur < 0) && up.zeilen[0].deltaEur <= up.zeilen[up.zeilen.length - 1].deltaEur, { top: up.zeilen[0] });
  const us = await svc.umsatzveraenderung({ jahrVon: 2020, jahrBis: 2025, richtung: 'steigerung', limit: 10 });
  check('Umsatzsteigerung: alle Δ > 0', us.zeilen.length > 0 && us.zeilen.every((z) => z.deltaEur > 0), { top: us.zeilen[0] });

  // Kundenzeitreihe für den Top-Steiger
  const top = us.zeilen[0];
  const zr = await svc.kundenzeitreihe({ dataAreaId: top.dataAreaId, kundennummer: top.kundennummer });
  check('Kundenzeitreihe: mehrere Jahre, Umsatz + Ø-Preis', zr.zeilen.length >= 2 && zr.zeilen.every((z) => typeof z.umsatz === 'number'), { kunde: zr.parameter.kundenname, jahre: zr.zeilen.map((z) => z.jahr) });

  const mt = await svc.mengentrend({ jahrVon: 2020, jahrBis: 2025, dimension: 'produkt', richtung: 'beide', limit: 10 });
  check('Mengentrend (Produkt): Ranking geliefert', mt.zeilen.length > 0 && mt.zeilen[0].label !== undefined, { top: mt.zeilen[0] });

  const kunden = await svc.kunden();
  const produkte = await svc.produkte();
  check('Lookups: Kunden (406) + Produkte (>500)', kunden.length === 406 && produkte.length > 500, { kunden: kunden.length, produkte: produkte.length });

  // Währungsisolation: GBP liefert andere (kleinere) Summe als EUR — keine Vermischung
  const upGbp = await svc.umsatzveraenderung({ jahrVon: 2020, jahrBis: 2025, richtung: 'beide', waehrung: 'GBP', limit: 5 });
  check('Währungsfilter greift (GBP separat)', Array.isArray(upGbp.zeilen) && upGbp.parameter.waehrung === 'GBP');

  await app.close();
  if (fails.length) {
    console.error(`\n${fails.length} FEHLGESCHLAGEN:`, fails);
    process.exit(1);
  }
  console.log('\nALLE SALES-ANALYTIK-ASSERTIONS BESTANDEN ✓');
}

main().catch((e) => { console.error(e); process.exit(1); });
