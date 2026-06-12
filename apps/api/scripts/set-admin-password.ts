import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

// Setzt das Passwort eines bestehenden Nutzers direkt (Seed-Stil, umgeht die Policy).
// Nur für Initial-/Notfall-Reset durch Admin. Erzwingt Passwortwechsel beim nächsten Login.
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = (process.env.SET_ADMIN_EMAIL ?? '').toLowerCase().trim();
  const pw = process.env.SET_ADMIN_PASSWORD ?? '';
  if (!email || !pw) throw new Error('SET_ADMIN_EMAIL und SET_ADMIN_PASSWORD sind erforderlich.');

  const passwortHash = await bcrypt.hash(pw, Number(process.env.BCRYPT_ROUNDS ?? 12));
  const user = await prisma.user.update({
    where: { email },
    data: { passwortHash, status: 'VERIFIZIERT', passwortWechselPflicht: true, fehlversuche: 0, gesperrtBis: null },
  });
  console.log(`Passwort gesetzt für ${user.email} (Rolle ${user.rolle}, Wechsel-Pflicht aktiv).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error((e as Error).message);
    await prisma.$disconnect();
    process.exit(1);
  });
