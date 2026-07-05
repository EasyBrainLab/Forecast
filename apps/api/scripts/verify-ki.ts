import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { KiConfigService, KI_KEYS } from '../src/ki/ki-config.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const cfg = app.get(KiConfigService);

  const fails: string[] = [];
  const check = (n: string, c: boolean): void => {
    console.log(`${c ? '✓' : '✗'} ${n}`);
    if (!c) fails.push(n);
  };

  // Ausgangszustand sichern und säubern
  const alteWerte = await prisma.einstellung.findMany({ where: { key: { in: Object.values(KI_KEYS) } } });
  await prisma.einstellung.deleteMany({ where: { key: { in: Object.values(KI_KEYS) } } });
  const envAnthropicVorher = process.env.ANTHROPIC_API_KEY;

  // ── Crypto-Roundtrip ──
  const geheim = 'sk-ant-test-1234567890-äöü-😀';
  const enc = cfg.verschluessele(geheim);
  check('Verschlüsselt ≠ Klartext, Format v1:iv:tag:data', !enc.includes(geheim) && enc.startsWith('v1:') && enc.split(':').length === 4);
  check('Roundtrip entschlüsselt exakt (inkl. Unicode)', cfg.entschluessele(enc) === geheim);
  check('Zwei Verschlüsselungen desselben Werts unterscheiden sich (IV)', cfg.verschluessele(geheim) !== enc);
  check('Manipulierter Ciphertext -> null (Auth-Tag)', cfg.entschluessele(enc.slice(0, -4) + 'AAAA') === null);

  // ── Auflösung: ohne DB-Eintrag greift ENV ──
  process.env.ANTHROPIC_API_KEY = 'env-key-fallback';
  check('Ohne DB-Eintrag: ENV-Fallback greift', (await cfg.anthropicKey()) === 'env-key-fallback');

  // ── DB-Eintrag hat Vorrang vor ENV ──
  await cfg.speichere({ anthropicKey: 'db-key-vorrang' });
  check('DB-Key hat Vorrang vor ENV', (await cfg.anthropicKey()) === 'db-key-vorrang');
  const rohInDb = (await prisma.einstellung.findUnique({ where: { key: KI_KEYS.ANTHROPIC_KEY_ENC } }))?.value ?? '';
  check('Key liegt NICHT im Klartext in der DB', !rohInDb.includes('db-key-vorrang') && rohInDb.startsWith('v1:'));

  // ── Status verrät Herkunft, nie den Wert ──
  const status = await cfg.status();
  check('Status meldet Herkunft DB (ohne Klartext)', status.anthropicKey === 'DB' && !JSON.stringify(status).includes('db-key-vorrang'));

  // ── Löschen (Leerstring) -> ENV-Fallback wieder aktiv ──
  await cfg.speichere({ anthropicKey: '' });
  check('Key löschen -> ENV-Fallback greift wieder', (await cfg.anthropicKey()) === 'env-key-fallback' && (await cfg.status()).anthropicKey === 'ENV');

  // ── Modell: DB-Vorrang + Default ──
  check('Modell-Default = claude-opus-4-8 (ohne LLM_MODEL-ENV)', process.env.LLM_MODEL ? true : (await cfg.llmModell()) === 'claude-opus-4-8');
  await cfg.speichere({ llmModell: 'claude-sonnet-5' });
  check('Modell aus DB hat Vorrang', (await cfg.llmModell()) === 'claude-sonnet-5');

  // ── Firmenprofil ──
  await cfg.speichere({ firmenprofil: 'Testfirma GmbH, Berlin' });
  check('Firmenprofil speicher-/lesbar', (await cfg.firmenprofil()) === 'Testfirma GmbH, Berlin');

  // ── Wiederherstellen ──
  await prisma.einstellung.deleteMany({ where: { key: { in: Object.values(KI_KEYS) } } });
  for (const alt of alteWerte) {
    await prisma.einstellung.create({ data: { key: alt.key, value: alt.value, beschreibung: alt.beschreibung } });
  }
  if (envAnthropicVorher === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = envAnthropicVorher;

  await app.close();
  if (fails.length) {
    console.error(`\n${fails.length} FEHLGESCHLAGEN:`, fails);
    process.exit(1);
  }
  console.log('\nALLE KI-CONFIG-ASSERTIONS BESTANDEN ✓');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
