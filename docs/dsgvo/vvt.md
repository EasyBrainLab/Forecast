# Verzeichnis von Verarbeitungstätigkeiten (VVT)

**Verantwortlicher:** Eckert & Ziegler, BU Brachytherapie.
**Verarbeitungstätigkeit:** Internes Sales-Forecast-Portal (Budget/Forecast/Ist-Konsolidierung).

| Punkt | Inhalt |
|---|---|
| Zweck | Planung, Bestätigung und Konsolidierung von Umsatz-Forecasts; rollenbasierte Berichterstattung |
| Betroffene | Beschäftigte (AGM, Vertriebsleitung, BU-Leitung, Admin, Support) |
| Datenkategorien | Name, dienstliche E-Mail, Rolle, Regionszuordnung, Anmelde-/Audit-Metadaten |
| Empfänger | keine externen; Hosting auf EU-VPS (Hetzner, Deutschland) |
| Drittland | nein |
| Löschfristen | siehe `loeschkonzept.md` |
| TOMs | TLS-Transport, JWT-Auth, Account-Lockout, Rollen-Guards, Kostenstellen-Scoping, Audit-Trail, tägliche Backups, ENV-Secrets |

Stand: bei Inbetriebnahme zu datieren und mit dem Datenschutzbeauftragten abzustimmen.
