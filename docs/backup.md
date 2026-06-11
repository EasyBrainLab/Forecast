# Backup

Täglicher `pg_dump | gzip` über den `backup`-Sidecar (`scripts/backup.sh`), abgelegt im Volume `backups`
(`/var/backups/forecast`). Rotation: `BACKUP_RETENTION_DAYS` (Default 14). Dead-Man-Switch: Backups < 1 KB führen zu Fehler.

Manuell:
```bash
docker compose -f docker-compose.prod.yml exec -e POSTGRES_HOST=postgres backup sh /backup.sh
```
Backups regelmäßig vom Server herunterladen / extern spiegeln (z. B. `scp`/Restic). Siehe `rpo-rto.md`.
