# Mapping-/Normalisierungsregeln (gegen Realdaten verifiziert)

Quelle: `packages/shared/src/constants.ts` + DB-Seed. KST-Nummer ist die alleinige Region-Wahrheit.

## Region
| Region | KST | Synonyme (Budget) |
|---|---|---|
| EP | 252 | AES |
| WIA | 253 | — |
| EMA | 254 | — |
| AGC | 255 | — |
| CS | 256, 257 | Radiotherapie |
| ZENTRAL | 110,150,200,220,262,264,270,280,500,690 | — (nicht forecast-relevant) |

## Produktgruppe E1
`1_Implants`/`Implant`/`Revenue Implants` → IMPLANT; analog OPHTHALMO, AFTERLOADER, OTHER. Sammel-KST → ZENTRAL.

## Produktgruppe E2 (Synonyme)
- `Stranded Seeds S06/S17` ≡ `…S06/S17+` ; `Loose Seeds S06/S17` ≡ `…S06/S17+` (einziges echtes Synonympaar)
- `Applicators & Equipment Mick` → E1 AFTERLOADER (laut Realdaten)
- leeres KTREB2 → Platzhalter „Unbekannt (E1)" (keine Quarantäne)

## Land
ISO-2 (Ist-CSV) ↔ englischer Klartext (Budget) über `nameEn`; Sonderfälle: `Czech`→CZ, `Korea, South`→KR,
`United States`→US, `United Kingdom`→GB. `pg`→PG (gültig). Leeres Country → Quarantäne.

## Budget-Excel Spalten (68, 0-basiert) — KORRIGIERT ggü. ursprünglichem Plan
- 7–18: EUR 2024 · 20–31: EUR 2025
- **51–62: EUR 2026** · **37–48: Units 2026** · 50: ASP (= EUR/Units, verifiziert)
- 64–67: Jahres-EUR 2027–2030 · `(Leer)`/`Erhöhung Platzhalter` → Regionsreserve (landlos)

## Ist-CSV
`wertEur := Value` MIT Vorzeichen (Σ = −ACCOUNTINGCURRENCYAMOUNT). POSTINGTYPE: alle summiert
(konfigurierbar via `POSTINGTYPE_WHITELIST`). RECID = idempotenter Schlüssel.
