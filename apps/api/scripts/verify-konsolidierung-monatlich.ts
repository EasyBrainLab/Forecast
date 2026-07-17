import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DashboardService } from '../src/dashboard/dashboard.service';
import type { RequestUser } from '../src/common/decorators/current-user.decorator';

/**
 * Nicht-destruktive Zahlenprobe: Die konsolidierte Monatssicht (konsolidierungMonatlich)
 * muss sich mit der bestehenden Konsolidierung (konsolidierung) decken.
 *  - Forecast-Summe == gesamt.forecastRest (identische Auswahl: jüngste Periode/Version je Zelle, >= istGrenze)
 *  - Budget-Summe    == gesamt.budget (für Jahre mit rein monatlichem Budget)
 *  - Ist-Summe       == roher ist_umsatz (Monate < istGrenze) — die Monatsansicht nutzt GL-Ist, kein SalesFlash
 * Liest ausschließlich; verändert die DB nicht.
 */
async function main(): Promise<void> {
  const jahr = Number(process.env.JAHR) || new Date().getUTCFullYear();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const dash = app.get(DashboardService);

  const adminRec = await prisma.user.findFirstOrThrow({ where: { rolle: 'ADMIN' } });
  const admin: RequestUser = { id: adminRec.id, email: adminRec.email, rolle: 'ADMIN' };

  const k = await dash.konsolidierung(jahr, admin);
  const km = await dash.konsolidierungMonatlich(jahr, admin);

  const sumRec = (r: Record<string, number>): number => Object.values(r).reduce((s, v) => s + v, 0);
  const istTotal = km.zeilen.reduce((s, z) => s + sumRec(z.istMonate), 0);
  const fcTotal = km.zeilen.reduce((s, z) => s + sumRec(z.forecastMonate), 0);
  const budTotal = km.zeilen.reduce((s, z) => s + sumRec(z.budgetMonate), 0);

  // Roh-Ist (GL) mit demselben Filter wie die Monatsmatrix.
  const istGrp = await prisma.istUmsatz.groupBy({
    by: ['e1Id'],
    where: { jahr, monat: { lt: km.restAbMonat } },
    _sum: { wertEur: true },
  });
  const rawIst = istGrp.reduce((s, g) => s + Number(g._sum.wertEur ?? 0), 0);

  const fails: string[] = [];
  const check = (n: string, ok: boolean): void => {
    console.log(`${ok ? '✓' : '✗'} ${n}`);
    if (!ok) fails.push(n);
  };
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.5;

  console.log(`Jahr=${jahr} Stichtag=${km.stichtag} restAbMonat=${km.restAbMonat} Produktgruppen=${km.zeilen.length}`);
  console.log(`  konsolidierung:  istYtd=${k.gesamt.istYtd} forecastRest=${k.gesamt.forecastRest} budget=${k.gesamt.budget}`);
  console.log(`  monatlich (Σ):   ist=${istTotal.toFixed(2)} forecast=${fcTotal.toFixed(2)} budget=${budTotal.toFixed(2)}`);
  console.log(`  roher GL-Ist:    ${rawIst.toFixed(2)}  (istQuelle der Konsolidierung: ${k.istQuelle})`);

  check('12 Monatsspalten', km.monate.length === 12);
  check('restAbMonat = Stichtag-Monat', km.restAbMonat === Number(km.stichtag.slice(5)));
  check('Forecast-Summe = konsolidierung.forecastRest', near(fcTotal, k.gesamt.forecastRest));
  check('Budget-Summe = konsolidierung.budget', near(budTotal, k.gesamt.budget));
  check('Ist-Summe = roher GL-Ist (ist_umsatz, Monat < istGrenze)', near(istTotal, rawIst));
  if (k.istQuelle === 'GL') {
    check('Ist-Summe = konsolidierung.istYtd (GL-Quelle)', near(istTotal, k.gesamt.istYtd));
  } else {
    console.log(`  (Ist-Vergleich zu gesamt.istYtd übersprungen: Konsolidierung nutzt ${k.istQuelle} als YTD-Override)`);
  }

  await app.close();
  if (fails.length) {
    console.error(`\n${fails.length} FEHLGESCHLAGEN:`, fails);
    process.exit(1);
  }
  console.log('\nKONSOLIDIERUNG-MONATLICH: ALLE ASSERTIONS BESTANDEN ✓');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
