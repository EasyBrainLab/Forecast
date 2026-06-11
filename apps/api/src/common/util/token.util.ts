import { createHash, randomBytes } from 'crypto';

/** Erzeugt einen kryptografisch sicheren Roh-Token + dessen SHA-256-Hash (nur Hash wird gespeichert). */
export function generateToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
