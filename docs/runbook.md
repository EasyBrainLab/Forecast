# Runbook — Erstbetrieb & Deployment (Hetzner)

## Voraussetzungen (Bringschuld §0.3)
1. **Hetzner-VPS** (Empfehlung CX32, 4 vCPU/8 GB), Docker + Docker Compose installiert.
2. **Domain + DNS:** A-Record auf die VPS-IP (Pflicht für Let's Encrypt).
3. **SMTP-Zugang** (Host/Port/User/Pass/From) für Einladungs-/Erinnerungsmails.
4. **GitHub-Repo** (privat) mit Secrets: `SERVER_HOST`, `SERVER_USER`, `DEPLOY_SSH_KEY`.

## Ersteinrichtung auf dem Server
```bash
sudo mkdir -p /opt/forecast-portal && cd /opt/forecast-portal
git clone <repo> .
cp .env.example .env            # ALLE Werte setzen (DOMAIN, *_SECRET, SMTP_*, POSTGRES_*, ACME_EMAIL, SEED_ADMIN_*)
openssl rand -base64 32         # -> JWT_SECRET
openssl rand -base64 32         # -> ENCRYPTION_KEY (VORHER offline sichern, siehe secrets.md)
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml run --rm api npx prisma migrate deploy
docker compose -f docker-compose.prod.yml run --rm api node -e "require('child_process')" # Platzhalter
```

## Stammdaten + Initial-Admin + Realdaten
```bash
# Seed (Stammdaten + Initial-Admin aus ENV)
docker compose -f docker-compose.prod.yml run --rm api pnpm seed
# Realdaten (3 Dateien nach /opt/forecast-portal/daten kopieren)
DATEN_DIR=/opt/forecast-portal/daten docker compose -f docker-compose.prod.yml run --rm -e DATEN_DIR api pnpm initial-import
```
Der erste Login erfolgt mit `SEED_ADMIN_EMAIL` / `ADMIN_INITIAL_PASSWORD` (Passwortwechsel wird erzwungen).
Admin lädt anschließend AGMs/Vertriebsleitung/BU-Leitung über die Nutzerverwaltung ein.

## Health & Smoke
`curl https://<DOMAIN>/api/health` → `{"status":"ok","db":"up"}`.

## Updates
`git pull && docker compose -f docker-compose.prod.yml build && docker compose ... run --rm api npx prisma migrate deploy && docker compose ... up -d`
(automatisiert via `.github/workflows/deploy.yml`).
