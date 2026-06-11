# Restore

```bash
# Dump auswählen
ls -1 /var/backups/forecast/

# In laufende DB einspielen (überschreibt!)
gunzip -c /var/backups/forecast/forecast-YYYYMMDD-HHMMSS.sql.gz \
  | docker compose -f docker-compose.prod.yml exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

Nach Restore: `docker compose -f docker-compose.prod.yml restart api` und Health prüfen.
Wichtig: `ENCRYPTION_KEY` muss identisch zum Zeitpunkt des Dumps sein (siehe `secrets.md`).
Restore mindestens halbjährlich auf einer Staging-DB proben.
