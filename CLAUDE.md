# CLAUDE.md — FORECAST-PORTAL BU BRACHYTHERAPIE

## Projektkontext
Webbasiertes Forecast-Portal der BU Brachytherapie (Eckert & Ziegler): Budget-, Forecast- und
Ist-Umsatzdaten je Kostenstelle/Land/Produktgruppe; monatlicher AGM-Bestätigungsworkflow; Excel-/Word-Reporting.
Stack-Variante: TypeScript Default · Regulated: Nein · Multi-Tenant: Nein (Kostenstellen-Scoping fail-closed) · KI: Nein.

## Stack
- Backend: NestJS 10, REST /api, Swagger /api/docs
- Frontend: Next.js 14 App Router, Tailwind, TanStack Query v5
- ORM: Prisma 5 | DB: PostgreSQL 16
- Auth: JWT (Passport-JWT) + bcryptjs, 8h, Invitation-Flow (7d-Token)
- Proxy: Traefik v2 + Let's Encrypt | Deploy: GitHub Actions -> SSH -> Hetzner VPS

## Kritische Konventionen
- Whitelist-PATCH auf allen Mutation-Routen (pickDefined, kein Body-Spreading) — CI-Guard `scripts/ci-guards.mjs`
- Kostenstellen-Scoping IMMER via ScopeService (fail-closed 403), live aus aktiver RegionsVerantwortung
- ForecastVersion / BudgetAenderungEvent / AuditTrail: append-only, DB-Trigger (P0001)
- Status-Transitionen nur über zentrale TRANSITIONS-Maps (@forecast/shared/statemachines) + StateMachineService
- Enums UPPERCASE, Domänenfelder Deutsch, Code-Identifier Englisch
- prisma migrate deploy in Prod, NIEMALS db push
- Import idempotent über RECID; Quarantäne statt silent skip
- Geld intern voller EUR (Decimal 15,2), Anzeige kEUR

## Domänenglossar
- Region: Gruppe von Kostenstellen (EP=252, WIA=253, EMA=254, AGC=255, CS=256+257)
- YEE: Ist YTD + Forecast Restmonate
- Schwellwert: Pflichtkommentar-Grenze (Einstellung, initial ±10%)
- Mapping-Wahrheit: KST-Nummer (Budget-Varianten AES→EP, Radiotherapie→CS)
- 2026-Budget-Excel: EUR in Spalten 51–62, Units in 37–48, ASP in 50 (gegen Realdaten verifiziert)

## Rollen
AGM | VERTRIEBSLEITER | BU_LEITER | ADMIN | SUPPORT

## Kritische Workflows
1. Monatlicher Forecast-Zyklus (OFFEN -> BESTAETIGT/ANGEPASST -> ABGESCHLOSSEN) — F1–F8
2. Budget-Änderung (zweistufig: Vertriebsleiter -> BU-Leiter, 4-Augen) — B2–B7
3. Ist-Import (RECID-Upsert, Validierungsbericht, Quarantäne)

## Verifikation
`pnpm --filter @forecast/shared test:cov` + `verify:ist|budget|budget-wf|forecast-wf|dashboard|export` (DATEN_DIR=Repo-Root).
