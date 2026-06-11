#!/usr/bin/env node
// CI-Guards (§7, §16): jeder Endpunkt MUSS @Roles oder @Public deklarieren (fail-closed);
// kein Body-Spreading (data:{...dto}) auf Mutationen.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'apps/api/src');
const HTTP = /@(Get|Post|Patch|Put|Delete)\(/;
const SCHUTZ = /@(Roles|Public|Authenticated)\(/;
const SPREAD = /data:\s*{\s*\.\.\./;

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (e.endsWith('.ts') && !e.endsWith('.spec.ts') && !e.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

const fehler = [];
for (const file of walk(ROOT)) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');

  // 1. Routen-Scan
  if (file.endsWith('.controller.ts')) {
    for (let i = 0; i < lines.length; i++) {
      if (!HTTP.test(lines[i])) continue;
      const fenster = lines.slice(Math.max(0, i - 7), i + 3).join('\n');
      if (!SCHUTZ.test(fenster)) {
        fehler.push(`${file}:${i + 1} — HTTP-Endpunkt ohne @Roles/@Public: ${lines[i].trim()}`);
      }
    }
  }

  // 2. Body-Spreading
  lines.forEach((l, i) => {
    if (SPREAD.test(l)) fehler.push(`${file}:${i + 1} — verbotenes Body-Spreading (data:{...}): ${l.trim()}`);
  });
}

if (fehler.length) {
  console.error('CI-Guards FEHLGESCHLAGEN:\n' + fehler.map((f) => '  - ' + f).join('\n'));
  process.exit(1);
}
console.log('CI-Guards bestanden ✓ (Routen-Scan + Whitelist-PATCH)');
