import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ForecastService } from '../src/forecast/forecast.service';

const AGM_EMAIL = 'agm.demo@ez.local';
const AGM_PW = 'Vertrieb-Start-2026!';
const REGION = 'AGC';
const PERIODE = '2026-06';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const fc = app.get(ForecastService);
  const admin = await prisma.user.findFirstOrThrow({ where: { rolle: 'ADMIN' } });

  // idempotent: bestehenden Demo-AGM entfernen
  await prisma.regionsVerantwortung.deleteMany({ where: { user: { email: AGM_EMAIL } } });
  await prisma.user.deleteMany({ where: { email: AGM_EMAIL } });

  const passwortHash = await bcrypt.hash(AGM_PW, 12);
  const agm = await prisma.user.create({ data: { email: AGM_EMAIL, name: 'Demo AGM (AGC)', rolle: 'AGM', status: 'VERIFIZIERT', passwortHash } });
  await prisma.regionsVerantwortung.create({ data: { userId: agm.id, regionCode: REGION, gueltigVon: new Date('2026-01-01') } });

  // Perioden 2026-06 für alle forecast-relevanten Regionen öffnen (seedet OFFEN-Versionen aus Budget)
  const regionen = await prisma.region.findMany({ where: { forecastRelevant: true } });
  for (const r of regionen) {
    await fc.oeffnePeriode(PERIODE, r.code, { id: admin.id, email: admin.email, rolle: 'ADMIN' });
  }

  const perioden = await prisma.forecastPeriode.count({ where: { periode: PERIODE } });
  const cells = await prisma.forecastVersion.count({ where: { periode: PERIODE, regionCode: REGION } });
  console.log(`AGM-Login:  ${AGM_EMAIL}  /  ${AGM_PW}   (Region ${REGION})`);
  console.log(`Perioden ${PERIODE} geöffnet: ${perioden} | Matrix-Zellen ${REGION}: ${cells}`);
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
