# Forecast-Portal BU Brachytherapie

Webbasierte Mehrbenutzer-Anwendung zur Konsolidierung des Sales-Forecast-Prozesses (Budget, Forecast, Ist-Umsatz) der BU Brachytherapie (Eckert & Ziegler). Führender Schlüssel ist die **Kostenstelle**; Personalwechsel ändern nur die historisierte `RegionsVerantwortung`.

## Stack
pnpm-Monorepo · NestJS 10 (API) · Next.js 14 (Web) · Prisma 5 + PostgreSQL 16 · JWT-Auth · Docker/Traefik · GitHub Actions → Hetzner.

```
packages/shared   # Domänenlogik (YEE, Abweichung, Schwellwert, Mappings) + Status-Maschinen — 100% Unit-Coverage
apps/api          # NestJS REST /api (Auth, Stammdaten, Import, Budget-/Forecast-Workflow, Dashboard, Export)
apps/web          # Next.js Frontend (rollenbasiert)
prisma/           # Schema, Migrationen (inkl. Append-only-Trigger), Seed
```

## Lokale Entwicklung
```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d        # Postgres + Mailpit (oder lokale Postgres)
cp .env.example apps/api/.env                          # DATABASE_URL etc. anpassen
pnpm --filter @forecast/shared build
pnpm --filter @forecast/api exec prisma migrate deploy
pnpm --filter @forecast/api seed                       # Stammdaten + Initial-Admin
pnpm dev                                               # API :4000, Web :3000
```

## Initial-Import der Realdaten (produktiv)
```bash
DATEN_DIR=/pfad/zu/den/3-dateien pnpm --filter @forecast/api initial-import
```
Erwartet `External_Revenue_BU_Therapie.csv`, `Budget_Umsatz_ProLand_ProAGM.xlsx`. Prüft die Abnahme-Summe Σ = 45.146.016,97 € (importiert).

## Verifikation (gegen Echtdaten, lokal)
```bash
pnpm --filter @forecast/shared test:cov               # 67 Unit-Tests, 100% Domain-Coverage
node scripts/ci-guards.mjs                             # Routen-/Whitelist-PATCH-Guards
DATEN_DIR=$(pwd) pnpm --filter @forecast/api verify:ist          # Σ=45.146.016,97, idempotent
DATEN_DIR=$(pwd) pnpm --filter @forecast/api verify:budget       # 2905 Zeilen, alle Jahres-Summen
DATEN_DIR=$(pwd) pnpm --filter @forecast/api verify:budget-wf    # zweistufiger Workflow, 4-Augen
DATEN_DIR=$(pwd) pnpm --filter @forecast/api verify:forecast-wf  # F1–F8, Schwellwert
DATEN_DIR=$(pwd) pnpm --filter @forecast/api verify:dashboard    # Konsolidierung, Scope
DATEN_DIR=$(pwd) pnpm --filter @forecast/api verify:export       # Excel/Word/CSV
```

## Deployment (Hetzner)
Siehe `docs/runbook.md`. Voraussetzungen (Bringschuld): Domain+DNS, SMTP, VPS-SSH, GitHub-Secrets. Danach:
`docker compose -f docker-compose.prod.yml up -d` (Traefik holt das TLS-Zertifikat automatisch).

## Sicherheit
Kostenstellen-Scoping fail-closed (403), Rollen-Guards (fail-closed), Whitelist-PATCH, Append-only-Trigger (P0001), Account-Lockout, Rate-Limiting, ENV-fail-fast. Details: `docs/secrets.md`, DSGVO unter `docs/dsgvo/`.
