# Datenklassifikation (DSGVO)

Das Portal verarbeitet **keine besonderen Kategorien** personenbezogener Daten (Art. 9 DSGVO).

| Datenart | Kategorie | Personenbezug | Speicherort |
|---|---|---|---|
| Mitarbeiter-Stammdaten (Name, dienstliche E-Mail) | intern | ja (Beschäftigte) | `user`, `regions_verantwortung` |
| Auth (Passwort-Hash bcrypt, Token-Hashes) | vertraulich | ja | `user` |
| Umsatz-/Budget-/Forecast-Daten | geschäftsvertraulich | nein | `ist_umsatz`, `budget`, `forecast_version` |
| AuditTrail (wer/was/wann) | intern | ja (Bearbeiter) | `audit_trail` (append-only) |

Es werden keine Kundendaten natürlicher Personen verarbeitet; Länder/Produktgruppen sind aggregierte Geschäftskennzahlen.
