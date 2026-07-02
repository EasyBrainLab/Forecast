-- CreateEnum
CREATE TYPE "CustomerSiteTyp" AS ENUM ('OEFFENTLICH', 'PRIVAT', 'UNBEKANNT');

-- CreateEnum
CREATE TYPE "CustomerSiteStatus" AS ENUM ('NEU', 'AKTIV', 'GEFAEHRDET', 'VERLOREN', 'ZURUECKGEWONNEN');

-- CreateTable
CREATE TABLE "customer_site" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stadt" TEXT,
    "landIso" TEXT,
    "regionCode" TEXT,
    "typ" "CustomerSiteTyp" NOT NULL DEFAULT 'UNBEKANNT',
    "status" "CustomerSiteStatus" NOT NULL DEFAULT 'NEU',
    "notiz" TEXT,
    "quellNamen" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_site_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_site_regionCode_idx" ON "customer_site"("regionCode");

-- CreateIndex
CREATE INDEX "customer_site_status_idx" ON "customer_site"("status");
