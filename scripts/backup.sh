#!/bin/sh
# Täglicher pg_dump (gzip) mit Rotation + Dead-Man-Switch. RPO 24h.
set -e
DIR="${BACKUP_DIR:-/var/backups/forecast}"
RETENTION="${BACKUP_RETENTION_DAYS:-14}"
HOST="${POSTGRES_HOST:-postgres}"
mkdir -p "$DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
FILE="$DIR/forecast-$STAMP.sql.gz"

pg_dump -h "$HOST" -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$FILE"

# Dead-Man-Switch: leeres/zu kleines Backup -> Fehler
SIZE=$(stat -c%s "$FILE" 2>/dev/null || stat -f%z "$FILE")
if [ "$SIZE" -lt 1024 ]; then
  echo "FEHLER: Backup $FILE zu klein ($SIZE Byte)" >&2
  exit 1
fi

# Rotation
find "$DIR" -name 'forecast-*.sql.gz' -mtime +"$RETENTION" -delete
echo "Backup OK: $FILE ($SIZE Byte)"
