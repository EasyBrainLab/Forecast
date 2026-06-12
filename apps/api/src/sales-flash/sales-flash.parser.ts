import { spawn } from 'child_process';

/** Sales-Flash-Region-Labels -> interne Region-Codes (Radiotherapy = CS). */
const LABEL_TO_REGION: Record<string, string> = { EP: 'EP', WIA: 'WIA', EMA: 'EMA', AGC: 'AGC', RADIOTHERAPY: 'CS' };

export interface ParsedActuals {
  total: number | null;
  regionen: { regionCode: string; eur: number }[];
}

/** Ruft `pdftotext -layout` auf dem PDF-Puffer auf (liest stdin, schreibt stdout). */
function pdfToText(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('pdftotext', ['-layout', '-', '-']);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout.on('data', (d: Buffer) => out.push(d));
    proc.stderr.on('data', (d: Buffer) => err.push(d));
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out).toString('utf8')) : reject(new Error(`pdftotext exit ${code}: ${Buffer.concat(err).toString()}`))));
    proc.stdin.on('error', () => undefined); // EPIPE ignorieren, falls pdftotext früh schließt
    proc.stdin.write(buffer);
    proc.stdin.end();
  });
}

/** "1.379.298" -> 1379298 ; "-" -> 0 ; sonst null (nicht numerisch). */
function parseNum(tok: string): number | null {
  if (tok === '-' || tok === '') return 0;
  const t = tok.replace(/\./g, '').replace(/,/g, '');
  return /^-?\d+$/.test(t) ? Number(t) : null;
}

/**
 * Liest die Region-Actuals aus der ACTUAL-Sektion eines Sales-Flash-PDFs.
 * Ankert an die erste "TOTAL SALES"-Zeile mit exakt (Regionen+1) Werten — die saubere Region-Summe
 * (spätere "TOTAL SALES"-Zeilen sind Monats-/Detailtabellen mit mehr Spalten).
 * Gibt null zurück, wenn das Layout nicht passt (Fallback: manuelle Erfassung).
 */
export async function parseSalesFlash(buffer: Buffer): Promise<ParsedActuals | null> {
  let text: string;
  try {
    text = await pdfToText(buffer);
  } catch {
    return null;
  }
  const lines = text.split('\n');

  // Region-Reihenfolge aus dem ACTUAL-Header
  const header = lines.find((l) => /\bEP\b/.test(l) && /\bWIA\b/.test(l) && /\bAGC\b/.test(l) && /TOTAL/.test(l));
  if (!header) return null;
  const order: string[] = [];
  for (const tok of header.trim().split(/\s+/)) {
    if (/^TOTAL$/i.test(tok)) break;
    const rc = LABEL_TO_REGION[tok.toUpperCase()];
    if (rc) order.push(rc);
  }
  if (order.length < 3) return null;

  // Erste "TOTAL SALES"-Zeile mit passender Spaltenzahl
  for (const line of lines) {
    if (!/^\s*TOTAL SALES\b/i.test(line)) continue;
    const rest = line.replace(/^\s*TOTAL SALES/i, '').trim();
    const nums = rest.split(/\s+/).map(parseNum);
    if (nums.some((n) => n === null)) continue;
    const vals = nums as number[];
    if (vals.length !== order.length + 1) continue; // Detailzeile -> überspringen
    return {
      total: vals[vals.length - 1],
      regionen: order.map((regionCode, i) => ({ regionCode, eur: vals[i] })),
    };
  }
  return null;
}
