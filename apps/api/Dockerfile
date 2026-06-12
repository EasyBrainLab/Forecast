# Multi-Stage Build für die NestJS-API (pnpm-Monorepo).
FROM node:22-slim AS base
# poppler-utils liefert `pdftotext` für das Auslesen der Sales-Flash-PDFs (Reconciliation-Auto-Fill).
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates poppler-utils && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @forecast/shared build
RUN pnpm --filter @forecast/api exec prisma generate
RUN pnpm --filter @forecast/api build

FROM base AS run
ENV NODE_ENV=production
COPY --from=build /app ./
WORKDIR /app/apps/api
EXPOSE 4000
# Migrationen forward-only anwenden, dann starten (niemals db push).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
