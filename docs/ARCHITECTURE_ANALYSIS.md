# ARCHITECTURE_ANALYSIS — Andockung des Sales-Reporting-Moduls

> **Zweck.** Diese Datei erfüllt Schritt 0 des Auftrags „Sales-Reporting-Modul in bestehendes
> Forecast-Tool integrieren": Sie dokumentiert den **vorgefundenen** Stand der Anwendung und wie das
> geplante Reporting-Modul angedockt wird.
> **Stand:** 2026-07-02 · **Grundlage:** Code-Analyse (Prisma-Schema, `apps/api`, `apps/web`,
> `packages/shared`), Fachkonzept v1.0, CLAUDE.md, Git-Historie.
> **Status:** Bestandsaufnahme. Die strategischen Weichen in §5 sind **offen** und noch nicht entschieden.

---

## 0. Kernbefund

Das Anforderungsdokument beschreibt kein Add-on, sondern faktisch ein **zweites, gleich großes Produkt**
auf derselben Datenbasis. Das heutige Tool ist ein **Zahlen-Konsolidierungssystem** (Budget/Forecast/Ist
je Region×Land×Produktgruppe). Das geforderte Modul ist ein **qualitatives, kundenscharfes,
KI-gestütztes Vertriebsberichtssystem** (Diktat, Tender, Wettbewerb, Klinik-Standorte, mehrsprachig, mobil).

- Rund **40 % der MVP-Bausteine existieren als Vorform** — auf genau dem Fundament (Scoping, Append-only,
  Import, Export, Mail/Scheduler), das der Auftrag verlangt.
- Die beiden namensgebenden **KI-Kernfunktionen (Diktat, Chatbot) haben null Vorarbeit**. Das Fachkonzept
  hatte KI bewusst als „vorbereitet, nicht aktiv" (Entscheidungsbaum F6) eingestuft — die jetzige
  Anforderung ist eine strategische Kehrtwende mit Datenschutz-Implikationen (§5.1).

---

## 1. Vorgefundener Stand

### 1.1 Architektur & Stack
- **Monorepo (pnpm workspaces):** `apps/api` (NestJS 10, REST unter `/api`, Swagger `/api/docs`),
  `apps/web` (Next.js 14 App Router), `packages/shared` (isomorphe Domänenlogik + Enums + State-Machines).
- **Daten:** Prisma 5 / PostgreSQL 16. `migrate deploy` in Prod, nie `db push`.
- **Betrieb:** Docker/Traefik, GitHub Actions → Hetzner VPS. Live: forecast.easybrainlab.com.
- **Konventionen (bindend, s. CLAUDE.md):** Domänenfelder Deutsch, Enums UPPERCASE, Code-Identifier
  Englisch; Geld intern voller EUR `Decimal(15,2)`, Anzeige kEUR; Whitelist-PATCH (`pickDefined`);
  append-only per DB-Trigger.

### 1.2 Fundament, das der Auftrag voraussetzt — und das bereits existiert
| Baustein | Ist-Zustand | Fundstelle |
|---|---|---|
| **Auth/RBAC** | JWT 8h, Invitation 7d, bcrypt, Lockout (5/30min→HTTP 423); globaler `RolesGuard` **fail-closed** (kein `@Roles` → 403) | `apps/api/src/auth`, `common/guards/roles.guard.ts` |
| **Scoping** | AGM-Reads live auf aktive `RegionsVerantwortung` gefiltert, fail-closed 403. **Where-Injektion je Service** (keine Prisma-Extension — CLAUDE.md hier ungenau) | `apps/api/src/scope/scope.service.ts` |
| **Import** | CSV (Ist), XLSX (Budget), CSV (Absatz); EU-Zahlenformat, RECID-Idempotenz, Quarantäne statt silent skip | `ist-import/`, `budget/`, `absatz/`, `packages/shared/.../parse-decimal-de.ts` |
| **Export** | XLSX (exceljs), **DOCX (docx)**, CSV — bereits im E&Z-CI mit Ampellogik | `apps/api/src/export/export.service.ts` |
| **Mail + Scheduler** | nodemailer + `@nestjs/schedule`; **Fristen-Erinnerung (Deadline−3), Eskalation (Deadline+1), Monatsabschluss** | `mail/`, `forecast/forecast.scheduler.ts` |
| **PDF-Extraktion** | `pdftotext -layout` (Poppler-CLI) via `child_process.spawn` | `sales-flash/sales-flash.parser.ts` |
| **Audit/Append-only** | `AuditTrail`, `ForecastVersion`, `BudgetAenderungEvent` per DB-Trigger geschützt | Prisma-Schema, Migration `..._append_only_triggers` |
| **State-Machines** | Zentrale Transitions (F1–F8, B2–B7), 4-Augen, Pflichtkommentar; Backend = Autorität | `packages/shared/src/statemachines`, `apps/api/src/workflow` |

### 1.3 Bereits vorhandene Module mit direktem Reporting-Bezug
| Modul | Was es heute leistet | Vorform von |
|---|---|---|
| `agm-statement` | Strukturierte AGM-Kommentare je Region/Periode: Abweichungsgrund (Enum), Risiken/Chancen, Pipeline, Kunden gewonnen/verloren, Preis/Wettbewerb, forecastRealistisch, Action-Items (JSON). Status ENTWURF→EINGEREICHT, Pflichtfeld-Prüfung, Whitelist-PATCH, Scoping | **`monthly_report`** |
| `forecast` | Restmonats-Forecast Land×E1, F1–F8, Ein-Klick-Bestätigung, Schwellwert-Pflichtkommentar, YEE-Matrix, append-only Versionen | Berichts-Abschnitt 5 (Ausblick/Forecast) |
| `absatz` | Stückzahlen (Seeds/Ruthen/IC/IS/S16) **kundenscharf** inkl. Vorjahr; CSV-Import; Kunde→Region-Mapping (`KundeRegion`) | `actual_figures` (Units), teilw. `customer_site` |
| `sales-flash` + `periode` | Controlling-PDF-Beleg, Region-Actuals, Cross-Source-Abgleich GL↔Sales-Flash, Monatsabschluss-Board mit Ampel; Wahrheits-Hierarchie SF>GL | Reconciliation-/Abgabestatus-Logik |
| `status-board` | Bestätigungsstatus je Region mit Frist | Head-of-Sales-Abgabeübersicht |

### 1.4 Frontend-Zustand (relevant für Aufwandsschätzung)
- 17 Routen unter `apps/web/src/app/(app)/`, TanStack Query v5, recharts. **CI-Farben #0F516A / #AA003C
  korrekt umgesetzt** (Tailwind `ez.*` + CSS-Vars).
- **`next-intl` installiert, aber komplett ungenutzt** — UI hart auf Deutsch (`<html lang="de">`), kein
  `messages/`, keine Middleware. → DE/EN/ES/PT ist ein durchgängiger Umbau.
- **Nicht mobil-optimiert**: feste `w-52`-Sidebar ohne Breakpoint/Hamburger; **kein MediaRecorder/getUserMedia**.
- **Myriad Pro** nicht eingebunden (Arial-Fallback). `react-hook-form`/`zod`/`lucide-react` als
  Dependencies vorhanden, aber ungenutzt.
- Route-Level-Rollenschutz nur über Nav-Filter — die echte Absicherung liegt (korrekt) im Backend.

### 1.5 KI / Voice — Bestand
**Null Vorarbeit.** Kein `@anthropic-ai/sdk`, kein OpenAI/LangChain, kein Whisper/STT, kein Audio-Upload,
keine Chat-Infrastruktur, kein API-Key-ENV. Verifiziert über alle `package.json` + `pnpm-lock.yaml`.

---

## 2. Gap-Analyse Datenmodell (gefordert → Ist)
Legende: ✅ vorhanden · 🟡 Vorform/Teilabdeckung · 🔴 fehlt

| Gefordert | Status | Ist-Zustand / Anmerkung |
|---|---|---|
| `plan_figures` | ✅ | `Budget` + `ForecastVersion` |
| `actual_figures` (Revenue) | 🟡 | `IstUmsatz` — kostenstellen-, **nicht kundenscharf** |
| `actual_figures` (Units) | ✅ | `Absatz` — kundenscharf, mit Vorjahr |
| `product_line` / `product` | 🟡 | `ProduktgruppeE1/E2`; Einzelprodukte teils nur in `Absatz.details` (JSON) |
| `sales_rep` | 🟡 | `User`(AGM) + `RegionsVerantwortung`; keine Entität, keine bevorzugte Sprache |
| `territory` | 🟡 | `Region` + `RegionsVerantwortung`; kein feineres Gebiet unterhalb Region |
| `monthly_report` | 🟡 | `AgmStatement` (deutlich schmaler; Status nur ENTWURF/EINGEREICHT) |
| `customer_site` | 🔴 | nur `Absatz.kunde` **String** (`SOL_DELIVERYADDRESSNAME`) + `KundeRegion`; keine Entität, kein Status/Typ/Adresse |
| `competitor` | 🔴 | nur Enum `AbweichungsGrund.WETTBEWERB` + Freitext; keine Stammliste |
| `report_section_entry` | 🔴 | `AgmStatement` hat feste Felder, keine flexiblen typisierten Einträge |
| `tender` | 🔴 | **fehlt komplett** (loser Bezug: `AgmStatement.pipeline`-Freitext) |
| `voice_session` | 🔴 | **fehlt komplett** |

---

## 3. Gap-Analyse Berichtsstruktur (9 Abschnitte) & KI

**Berichtsabschnitte:** 2 (Plan/Ist) und 5 (Forecast) über bestehende Module abgedeckt; 7 (Wettbewerb) und
8 (Markt/Personal) teilweise über `AgmStatement`-Freitext. **Neu:** 1 (Kritische Themen, typisiert +
`customer_site`-Verknüpfung), 3 (Aktivitäten Neu-/Bestandskunden), 4 (Marketing/Kongresse), 6 (Nächste
Aktivitäten), Projektliste in 5. Die wiederholbare `report_section_entry`-Mechanik fehlt durchgängig.

**KI-Agenten:**
| Agent | Status |
|---|---|
| 1 – Voice-to-Report (Whisper + Claude-Extraktion, **Zahlen-Guardrail**) | 🔴 null Vorarbeit |
| 2 – Vollständigkeits-Chatbot (DB-konfigurierbare Regeln) | 🔴 null Vorarbeit |
| 3 – Management-Summary | 🟡 Export-Pipeline (DOCX/XLSX) da, keine Textgenerierung |

**Nicht-funktional:** Mehrsprachigkeit DE/EN/ES/PT 🔴 (next-intl ungenutzt); Mobile-first + Voice 🔴;
Audit/Unveränderlichkeit ✅ Fundament; serverseitige LLM/STT-Aufrufe ✅ Architektur passt, Anbindung fehlt.

---

## 4. Andock-Strategie (wie das Modul einhängt)
- **Scope/RBAC:** Neue Reporting-Endpoints übernehmen den bestehenden `ScopeService` (Region-Filter,
  fail-closed) und `@Roles`. Region ↔ Kostenstelle ↔ RegionsVerantwortung bleibt die Scope-Brücke.
- **`monthly_report`:** Bevorzugt **Ausbau von `AgmStatement`** statt Neubau — Scoping, Einreich-Workflow,
  Pflichtfeld-Logik und UI (`/statement`) sind wiederverwendbar. Erweiterung um `report_section_entry`,
  Tender-/Aktivitäts-/Marketing-Abschnitte, erweitertes Status-Set (draft/in_review_ai/submitted/read).
- **`tender`:** Neues, weitgehend isoliertes Modul; Fristen-Reminder über den **vorhandenen Scheduler**
  (`@nestjs/schedule`) analog Forecast-Deadline. Guter Quick-Win.
- **`customer_site` / `competitor`:** Neue Stammdaten-Entitäten, eingehängt ins bestehende Stammdaten-Modul.
  `customer_site` per Migration/Fuzzy-Match aus `Absatz.kunde` + `KundeRegion` befüllen.
- **Plan/Ist im Report:** Vorbefüllung aus `forecast`/`absatz`/`IstUmsatz`; Report-Forecast schlägt eine
  Forecast-Revision vor (an F1–F8 andocken statt Parallelhaltung).
- **Export/Management-Summary:** Auf `export.service.ts` (DOCX/XLSX, E&Z-CI) aufsetzen.
- **KI serverseitig:** Neuer NestJS-Service, Keys per ENV (fail-fast), Audio-Upload + STT + LLM-Extraktion;
  **Zahlen-Guardrail** als Pflicht-Bestätigungsschritt vor Persistierung.
- **i18n:** next-intl-Gerüst aktivieren **bevor** viele neue Seiten entstehen (nachträglich teurer).

---

## 5. Offene strategische Weichen (zu entscheiden vor Umsetzung)
1. **KI-Datenschutz.** Vertrauliche Vertriebsdaten (Kunden, Preise, Wettbewerb, Diktate) an Claude API +
   Whisper: AVV/EU-Hosting mit Anthropic akzeptabel, oder self-hosted STT/LLM zwingend? Bestimmt Machbarkeit
   und Betriebskosten. (Fachkonzept F6 stand ursprünglich auf „keine KI".)
2. **`AgmStatement` erweitern vs. `monthly_report` neu.** Empfehlung: **aufbohren** (Fundament ist da).
3. **Kundenscharfe EUR.** `actual_figures.revenue_actual` je `customer_site` — Quelle heute nur mengenscharf
   (`Absatz`). GL ist kostenstellenscharf, Sales-Flash regionscharf. Manuelle Erfassung oder neuer Import?
4. **„Kunde" String → Entität.** Migrationspfad aus `SOL_DELIVERYADDRESSNAME` + Fuzzy-Match; Datenqualitätsrisiko.
5. **Rep-Rolle.** Dokument trennt „rep" (berichtet oft gar nicht) von „agm"; Tool kennt nur `AGM`. Eigene
   untergeordnete REP-Rolle? (berührt Scope-Modell).
6. **Doku-Unstimmigkeiten:** (a) „territory (Gebietscode P12F055)" — P12F055 ist die **QMS-Formularnummer**
   der Word-Vorlage, kein Gebietscode; „territory" ist vermutlich = bestehende `Region`. (b) Schritt 0 nennt
   einen **Platzhalter für eine separate Architekturvorgabe des Auftraggebers** (hätte Vorrang) — existiert die?

---

## 6. Empfohlener Zuschnitt
Der 4-Stufen-Plan des Auftrags (MVP → Voice → Chatbot → Management-Summary) ist tragfähig; er schiebt KI ans
Ende. Innerhalb des MVP empfiehlt sich „wiederverwendbare Nähe zuerst":

- **MVP-A (bestandsnah):** `tender` + Fristen-Reminder · `competitor`-Stammliste · `AgmStatement` →
  `monthly_report` ausbauen (report_section_entry, Aktivitäten, Marketing).
- **MVP-B (neues Fundament):** `customer_site`-Entität + Migration aus Absatz-Kunden; kundenscharfe Plan/Ist-Sicht.
- **Querschnitt früh:** i18n-Gerüst aktivieren, bevor neue Seiten entstehen.

Nach jeder Stufe lauffähiger, deploybarer Stand (Prinzip aus dem bestehenden E1–E14-Plan beibehalten).

---

## 7. Umsetzungsstand

### Etappe R1 — Tender-Modul (fertig, verifiziert · 2026-07-02)
Erster bestandsnaher MVP-Baustein, end-to-end nach dem `agm-statement`-Muster.
- **Datenmodell:** `Tender` + `TenderLos` + Enum `TenderStatus` (BEOBACHTET/EINGEREICHT/GEWONNEN/VERLOREN/STORNIERT);
  Migration `20260702192141_tender` (rein additiv, keine Änderung an bestehenden Modellen).
- **Backend:** `apps/api/src/tender/` (Service/Controller/Scheduler/Module) — Scoping fail-closed über
  `ScopeService` (AGM: eigene Region; Lesen/Holen/Schreiben), Whitelist-PATCH, Audit-Trail, RBAC.
- **Fristen-Reminder:** `TenderScheduler` (täglich 07:00) mit gestufter, idempotenter Erinnerung 14/7/3/1 Tage
  vor Frist; reine Schwellen-Logik als getestete Domänenfunktion `naechsteReminderSchwelle` in `@forecast/shared`.
- **Frontend:** `/tender` (Board mit Dringlichkeits-Ampel nach Frist, Status-Verwaltung, Erfassungsformular inkl.
  Lose, Wettbewerber, Preisvergleich) + Nav-Eintrag.
- **Verifikation:** Typecheck (3 Pakete) grün · CI-Guards grün · `shared` 100 % Coverage (75 Tests) ·
  `pnpm --filter @forecast/api verify:tender` (17 Assertions: CRUD, Scoping, Pflichtfelder, Whitelist-PATCH,
  Audit, Frist-Reset, Scheduler-Verdrahtung, Cascade-Delete) grün. **Abnahmekriterium „Frist in 14 Tagen erzeugt
  Erinnerung an zuständigen Rep" erfüllt.**

### Etappe R2 — Wettbewerber-Stammliste (fertig, verifiziert · 2026-07-02)
Rundet die Tender-Wettbewerbsangabe ab („aus Stammliste statt Freitext", Auftrag Abschnitt 7).
- **Datenmodell:** `Competitor` (name unique, aktiv, notiz, sortierung); Migration `..._competitor` (additiv).
  Seed der initialen 6 (BXTAccelyon, Ekrior, Bard/Palex, Theragenics, Elekta, Varian), idempotent.
- **Backend:** `apps/api/src/competitor/` — CRUD nach Stammdaten-Muster (Lesen alle Rollen, Mutationen ADMIN,
  Whitelist-PATCH, Audit); Soft-Deaktivierung (`aktiv=false`) erhält Historie, `?nurAktiv=true` für Auswahllisten.
- **Frontend:** `/admin/competitor` (Verwaltung; ADMIN schreibt, SUPPORT liest) + Nav; Tender-Formular wählt
  Wettbewerber jetzt per Checkbox aus der Stammliste statt Freitext.
- **Verifikation:** Typecheck grün · CI-Guards grün · `verify:tender` erweitert (**21 Assertions** inkl.
  Competitor-CRUD + Aktiv-Filter) grün.

### Etappe R3 — Customer-Site (Klinik/Standort) mit Fuzzy-Match (fertig, verifiziert · 2026-07-02)
- **Datenmodell:** `CustomerSite` (name, stadt, landIso, regionCode, Typ öffentlich/privat/unbekannt, Status
  neu/aktiv/gefährdet/verloren/zurückgewonnen, `quellNamen[]`) + Enums; Migration `..._customer_site` (additiv).
- **Fuzzy-Match:** pure Domänenfunktion `findeSiteKandidaten`/`nameAehnlichkeit` (Token-Jaccard über normalisierte
  Namen) in `@forecast/shared`, 100 % getestet.
- **Backend:** `apps/api/src/customer-site/` — CRUD + fail-closed Scoping, Whitelist-PATCH, Status-Workflow
  (AGM nur eigene Region), Audit; **Bestätigungs-Workflow**: `GET /customer-site/vorschlaege` liefert unzugeordnete
  `Absatz.kunde`-Strings mit Match-Vorschlägen + Region-Vorschlag, `POST /customer-site/zuordnen` bestätigt
  (neu anlegen ODER bestehendem zuordnen) — **nie automatisch**.
- **Frontend:** `/admin/customer-site` — Bestätigungsbereich (Vorschläge → neu/zuordnen) + Stammdatentabelle
  (Status/Typ/Region inline pflegbar) + manuelles Anlegen.
- **Verifikation:** Typecheck grün · CI-Guards grün · `shared` 100 % (90 Tests) · `verify:customer-site`
  (**14 Assertions**: CRUD, Scoping, Status-Workflow, Whitelist, Fuzzy-Vorschläge, Zuordnen neu/bestehend/idempotent).

### Rollout-Sprint (fertig, verifiziert · 2026-07-05) — Etappen Q, I, R4, V, H
Auftrag: „komplett fertige Anwendung, sofort ans Salesteam ausrollbar" (Nutzer-Entscheid: Reihenfolge
Quick-Wins → i18n → R4 → Voice; KI-Datenschutz: Claude API mit AVV/EU akzeptiert).

- **Q — Quick-Wins:** Export-Center `/export` (Backend existierte, UI fehlte) · Absatz-Import gehärtet
  (Summen-/Leer-/Nullzeilen mit Grund aussortiert; Summentreue exakt gegen Realdatei; namenlose Mengen-Zeilen
  als `(ohne Kundenname)` erhalten) · Quarantäne-Klär-UI `/admin/quarantaene` (klären/verwerfen + Kommentar).
- **I — i18n DE/EN:** next-intl aktiviert (Cookie-Locale ohne URL-Routing, Umschalter im Header/Login).
  AGM-Flows vollständig zweisprachig (Nav, Login, Einladung, Passwort, Übersicht, Forecast beide Sichten,
  Tender, Absatz, Export, Report, Hilfe, Voice). Admin-/Controlling-Seiten bewusst DE. Laufzeit verifiziert
  (`lang=de/en` + übersetzte Strings per Cookie).
- **R4 — Monatsbericht:** `MonthlyReport` + `ReportEintrag` (FKs auf CustomerSite/Competitor/Tender/E1);
  8 Abschnitte als typisierte Einträge; automatische Plan/Ist/Δ/YTD/PY-Zahlensektion je Produktlinie
  (kein Abtippen); Pflichtprüfung beim Einreichen (Forecast Folgemonat+Quartal, Wettbewerb ≥1 aus Stammliste
  ODER Keine-Änderung-Erklärung); Status ENTWURF→EINGEREICHT→GELESEN mit Lesebestätigung; Manager-Board
  `/report-board` mit Überfälligkeit (Frist = `REPORT_DEADLINE_TAG` des Folgemonats); Scheduler Frist−3/Frist+1.
  `/statement` bleibt als Altzugriff erreichbar, ist aus der Nav ersetzt. `verify:report`: 16 Assertions.
- **V — Voice-Diktat (Stufe 2):** Audio → Whisper-STT → Claude-Extraktion (`claude-opus-4-8`, structured
  outputs) → vorbefüllte Maske. **Zahlen-Guardrail:** jede extrahierte Zahl mit wörtlichem Transkript-Kontext,
  Einzelbestätigung/Korrektur Pflicht vor Übernahme. Serverseitiges Stammdaten-Matching (Fuzzy Site, exakt
  Competitor) als Vorschlag. `VoiceSession` (Transkript = Audit; Audio-Retention `AUDIO_AUFBEWAHRUNG`
  SOFORT_LOESCHEN/TAGE_30/BEHALTEN + Retention-Job). Provider-Abstraktion mit Mocks; Feature-Detection
  `/voice/status` — ohne ENV-Keys sauber deaktiviert, Maske voll nutzbar. `verify:voice`: 12 Assertions
  (E2E mit Mock-STT, wie im Auftrag gefordert). Keys: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (docs/secrets.md).
- **H — Eingebettete Schulung:** `/hilfe` DE/EN — rollenbasierte Kapitel (Erste Schritte, Forecast,
  Monatsbericht, Diktat inkl. Zahlen-Prüfung, Tender, Leitung, Administration, FAQ) + AGM-Schnellstart
  („Monatsritual in 3 Schritten") für den Rollout ans Salesteam.

Auftragsstatus damit: **MVP + Stufe 2 vollständig**; Stufe 3 (Vollständigkeits-Chatbot) und Stufe 4
(Management-Summary/ERP) bleiben offen. Verify-Suite: `verify:ist|budget|budget-wf|forecast-wf|dashboard|
export|absatz|erweiterungen|tender|customer-site|report|voice`.

**Gesamtverifikation 2026-07-05:** shared 90 Tests/100 % Coverage · Typecheck 3/3 · CI-Guards ·
`pnpm -r build` inkl. `next build` (24 Routen) · Verify-Suite 10/12 grün. **Bekannt/vorbestehend (auch auf
main):** `verify:dashboard` und `verify:export` eichen feste YTD-Sollwerte auf das Juni-Fenster und schlagen
seit Monatswechsel kalendarisch fehl — Branch berührt diese Services/Skripte nicht; empfohlener Folge-Fix:
Stichtag im Test pinnen. Aufruf-Hinweis: Alt-Skripte erwarten `DATEN_DIR=<abs. Pfad>/docs`, die neueren
(`absatz`, `erweiterungen`) `DATEN_DIR=<Repo-Root>`.

### Bewusste MVP-Annahmen (revidierbar)
- **A-R1:** `customer_site` (R3) und `competitor` (R2) sind Entitäten, aber `Tender` referenziert sie noch nicht
  per FK — `Tender.krankenhaus` bleibt String, `Tender.wettbewerber` String[] (Namen). FK-Verknüpfung von
  Tender an customer_site/competitor folgt additiv.
- **A-R2:** Region-Bezug als String ohne FK (konsistent mit `agm_statement.regionCode`) — minimal-invasiv.
- **A-R3:** **Keine** neue REP-Rolle im MVP; `AGM` ist die berichtende, regions-gescopte Rolle.
- **A-R4:** `AgmStatement` bleibt unangetastet; Ausbau zum vollen `monthly_report` erst in späterer Etappe.
- **A-R5:** Region-Dropdown im Tender-Formular zeigt alle forecast-relevanten Regionen (nicht AGM-gescopt);
  fremde Region wird serverseitig fail-closed abgelehnt (403). UX-Feinschliff später.

### Nächste Etappen (Vorschlag)
- **R4:** `AgmStatement` → `monthly_report` ausbauen (report_section_entry, Aktivitäten, Marketing, Projektliste).
- **R5:** `Tender`/`monthly_report` per FK an `customer_site`/`competitor` verknüpfen (additiv).
- **Querschnitt:** i18n-Gerüst (next-intl) aktivieren, bevor weitere Seiten entstehen.
