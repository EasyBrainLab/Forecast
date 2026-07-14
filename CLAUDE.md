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
1. Monatlicher Forecast-Zyklus (OFFEN -> BESTAETIGT/ANGEPASST -> ABGESCHLOSSEN) — F1–F9.
   Abschluss (F6–F8: Cron ODER BU_LEITER/ADMIN) kaskadiert auf alle älteren Perioden der Region;
   Wiedereröffnung (F9: VERTRIEBSLEITER/BU_LEITER/ADMIN, Begründung Pflicht) auf alle jüngeren.
   Invariante: bis zur jüngsten abgeschlossenen Periode ist lückenlos alles abgeschlossen.
2. Budget-Änderung (zweistufig: Vertriebsleiter -> BU-Leiter, 4-Augen) — B2–B7
3. Ist-Import (RECID-Upsert, Validierungsbericht, Quarantäne)

## Verifikation
`pnpm --filter @forecast/shared test:cov` + `verify:ist|budget|budget-wf|forecast-wf|dashboard|export|absatz|erweiterungen|tender|customer-site|report|voice|ki|tender-analyse` (Alt-Skripte: DATEN_DIR=<abs>/docs; neue: Repo-Root).

## Sales-Reporting-Modul (seit 2026-07)
Tender (Fristen-Reminder 14/7/3/1) · Competitor-/CustomerSite-Stammdaten (Fuzzy-Match-Bestätigung) ·
MonthlyReport (8 Abschnitte, Pflicht: Forecast+Wettbewerb, GELESEN-Bestätigung, Frist REPORT_DEADLINE_TAG) ·
Voice-Diktat (Whisper+Claude `claude-opus-4-8`, Zahlen-Guardrail, Audio-Retention AUDIO_AUFBEWAHRUNG) ·
KI-Konfiguration im Tool: /admin/ki (Modell + Keys AES-verschlüsselt in Einstellung, DB→ENV-Fallback via
KiConfigService — Keys NIE loggen/zurückgeben) · Tender-Analyse-Agent: PDF als document-Block an Claude,
Guardrail, Tender-Übernahme + DOCX-Antwortentwurf (/tender-Panel) · i18n DE/EN (next-intl, Cookie) · /hilfe.
