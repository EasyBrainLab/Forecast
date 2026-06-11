import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { E1Kategorie, E2_TABLE, EINSTELLUNG_DEFAULTS, e2UnbekanntName } from '@forecast/shared';
import { LAENDER } from './data/laender';
import { KOSTENSTELLEN, REGIONEN } from './data/kostenstellen';
import { E1_SEED } from './data/produktgruppen';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // 1. Einstellungen
  for (const [key, value] of Object.entries(EINSTELLUNG_DEFAULTS)) {
    await prisma.einstellung.upsert({ where: { key }, update: {}, create: { key, value } });
  }

  // 2. Regionen
  for (const r of REGIONEN) {
    await prisma.region.upsert({
      where: { code: r.code },
      update: { bezeichnung: r.bezeichnung, forecastRelevant: r.forecastRelevant, synonyme: r.synonyme },
      create: { code: r.code, bezeichnung: r.bezeichnung, forecastRelevant: r.forecastRelevant, synonyme: r.synonyme },
    });
  }

  // 3. Kostenstellen
  for (const k of KOSTENSTELLEN) {
    await prisma.kostenstelle.upsert({
      where: { nummer: k.nummer },
      update: { bezeichnung: k.bezeichnung, regionCode: k.regionCode, istSammel: k.istSammel, company: k.company },
      create: k,
    });
  }

  // 4. Länder
  for (const l of LAENDER) {
    await prisma.land.upsert({
      where: { isoCode: l.isoCode },
      update: { nameDe: l.nameDe, nameEn: l.nameEn },
      create: l,
    });
  }

  // 5. ProduktgruppeE1
  const e1IdByKat = new Map<string, string>();
  for (const e of E1_SEED) {
    const rec = await prisma.produktgruppeE1.upsert({
      where: { kategorie: e.kategorie },
      update: { nameDe: e.nameDe, nameEn: e.nameEn, synonyme: e.synonyme, sortierung: e.sortierung },
      create: e,
    });
    e1IdByKat.set(e.kategorie, rec.id);
  }

  // 6. ProduktgruppeE2 (17 real + 4 Platzhalter "Unbekannt (E1)")
  for (const d of E2_TABLE) {
    const e1Id = e1IdByKat.get(d.e1);
    if (!e1Id) throw new Error(`E1 für E2 ${d.name} fehlt`);
    await prisma.produktgruppeE2.upsert({
      where: { name: d.name },
      update: { e1Id, synonyme: [...d.synonyme] },
      create: { name: d.name, e1Id, synonyme: [...d.synonyme], istPlatzhalter: false },
    });
  }
  for (const kat of [
    E1Kategorie.IMPLANT,
    E1Kategorie.OPHTHALMO,
    E1Kategorie.AFTERLOADER,
    E1Kategorie.OTHER,
    E1Kategorie.ZENTRAL,
  ]) {
    const name = e2UnbekanntName(kat);
    const e1Id = e1IdByKat.get(kat);
    if (!e1Id) throw new Error(`E1 ${kat} fehlt`);
    await prisma.produktgruppeE2.upsert({
      where: { name },
      update: { e1Id },
      create: { name, e1Id, synonyme: [], istPlatzhalter: true },
    });
  }

  // 7. Initial-Admin (idempotent: bestehender Admin wird NICHT überschrieben)
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@localhost').toLowerCase();
  const name = process.env.SEED_ADMIN_NAME ?? 'System Administrator';
  const pw = process.env.ADMIN_INITIAL_PASSWORD ?? 'Bitte-Aendern-12!';
  const passwortHash = await bcrypt.hash(pw, Number(process.env.BCRYPT_ROUNDS ?? 12));
  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name,
      rolle: 'ADMIN',
      status: 'VERIFIZIERT',
      passwortHash,
      passwortWechselPflicht: true,
    },
  });

  const [regionen, kst, laender, e1, e2, einst] = await Promise.all([
    prisma.region.count(),
    prisma.kostenstelle.count(),
    prisma.land.count(),
    prisma.produktgruppeE1.count(),
    prisma.produktgruppeE2.count(),
    prisma.einstellung.count(),
  ]);
  console.log(
    `Seed OK — Regionen:${regionen} KST:${kst} Länder:${laender} E1:${e1} E2:${e2} Einstellungen:${einst} Admin:${email}`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
