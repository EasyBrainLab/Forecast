# RPO / RTO

- **RPO (Recovery Point Objective): 24 h** — tägliches pg_dump-Backup. Max. Datenverlust = ein Tag.
- **RTO (Recovery Time Objective): ~1 h** — Neuaufsetzen Compose-Stack + Restore des letzten Dumps.

Maßnahmen zur Einhaltung:
- Backups extern spiegeln (off-site), nicht nur im Server-Volume.
- `ENCRYPTION_KEY` offline + getrennt vom DB-Backup aufbewahren (`secrets.md`).
- Restore halbjährlich proben (`restore.md`).
- Append-only-Tabellen (AuditTrail/ForecastVersion/BudgetAenderungEvent) sichern die Nachvollziehbarkeit auch nach Teil-Restores.
