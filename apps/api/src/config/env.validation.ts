import { z } from 'zod';

// Fail-fast ENV-Validierung (§11 Punkt 9/10). Wirft beim Boot, wenn Pflicht-Variablen fehlen.
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_BASE_URL: z.string().url(),
  DOMAIN: z.string().min(1),

  DATABASE_URL: z.string().min(1),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET muss mindestens 32 Zeichen haben'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length >= 32, 'ENCRYPTION_KEY muss base64-kodiert >= 32 Byte sein'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  INVITATION_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  RESET_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(2),
  LOCKOUT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOCKOUT_WINDOW_MIN: z.coerce.number().int().positive().default(30),

  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  SMTP_FROM: z.string().min(1),

  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_NAME: z.string().optional(),
  ADMIN_INITIAL_PASSWORD: z.string().optional(),

  BACKUP_DIR: z.string().optional().default('/var/backups/forecast'),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().positive().default(14),
  TZ: z.string().default('Europe/Berlin'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // fail-fast: ohne gültige Konfiguration startet die App nicht.
    throw new Error(`Ungültige Umgebungskonfiguration:\n${issues}`);
  }
  return parsed.data;
}
