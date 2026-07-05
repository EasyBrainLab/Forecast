# Secrets-Handling

Alle Secrets ausschließlich per ENV (fail-fast: die API startet ohne gültige Werte nicht — `env.validation.ts`).

| Variable | Zweck | Erzeugung |
|---|---|---|
| `JWT_SECRET` | JWT-Signatur (≥32 Zeichen) | `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | Krypto-Schlüssel (32 Byte base64) | `openssl rand -base64 32` |
| `POSTGRES_PASSWORD` | DB-Passwort | `openssl rand -base64 24` |
| `SMTP_PASS` | Mailversand | vom Provider |
| `DEPLOY_SSH_KEY` | CI-Deploy | dedizierter Deploy-Key |
| `ADMIN_INITIAL_PASSWORD` | erster Admin-Login | stark, wird beim 1. Login gewechselt |
| `ANTHROPIC_API_KEY` | KI-Extraktion Voice-Diktat (Claude API, AVV/EU) | Anthropic Console; optional — ohne Key ist Diktat deaktiviert |
| `OPENAI_API_KEY` | Speech-to-Text (Whisper API) fürs Diktat | OpenAI Console; optional — ohne Key ist Diktat deaktiviert |

**ENCRYPTION_KEY VOR Erstbetrieb offline sichern** (Passwortmanager/Tresor), **getrennt vom DB-Backup**.
Ohne diesen Schlüssel sind ggf. verschlüsselte Daten nach einem Restore nicht lesbar.

Niemals committen: `.env`, Realdaten (CSV/XLSX/DOCX) — durch `.gitignore`/`.dockerignore` ausgeschlossen.
GitHub-Secrets: `SERVER_HOST`, `SERVER_USER`, `DEPLOY_SSH_KEY` (+ optional ENV für Build).
