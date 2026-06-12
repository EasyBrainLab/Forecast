-- CreateEnum
CREATE TYPE "AbweichungsGrund" AS ENUM ('KEINE_ABWEICHUNG', 'MARKT', 'WETTBEWERB', 'PREIS', 'PROJEKTVERSCHIEBUNG', 'REGULATORISCH', 'LIEFERFAEHIGKEIT', 'EINMALEFFEKT', 'SONSTIGES');

-- CreateEnum
CREATE TYPE "StatementStatus" AS ENUM ('ENTWURF', 'EINGEREICHT');

-- AlterTable
ALTER TABLE "absatz" ADD COLUMN     "regionCode" TEXT;

-- CreateTable
CREATE TABLE "kunde_region" (
    "id" TEXT NOT NULL,
    "kunde" TEXT NOT NULL,
    "regionCode" TEXT NOT NULL,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kunde_region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agm_statement" (
    "id" TEXT NOT NULL,
    "periode" TEXT NOT NULL,
    "jahr" INTEGER NOT NULL,
    "monat" INTEGER NOT NULL,
    "regionCode" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "abweichungGrund" "AbweichungsGrund" NOT NULL DEFAULT 'KEINE_ABWEICHUNG',
    "abweichungKommentar" TEXT,
    "risiken" TEXT,
    "chancen" TEXT,
    "pipeline" TEXT,
    "kundenGewonnen" TEXT,
    "kundenVerloren" TEXT,
    "preisWettbewerb" TEXT,
    "forecastRealistisch" BOOLEAN NOT NULL DEFAULT true,
    "forecastKommentar" TEXT,
    "actionItems" JSONB NOT NULL DEFAULT '[]',
    "status" "StatementStatus" NOT NULL DEFAULT 'ENTWURF',
    "eingereichtAm" TIMESTAMP(3),
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agm_statement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_flash_dokument" (
    "id" TEXT NOT NULL,
    "jahr" INTEGER NOT NULL,
    "monat" INTEGER NOT NULL,
    "dateiname" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "groesseBytes" INTEGER NOT NULL,
    "inhalt" BYTEA NOT NULL,
    "actuals" JSONB NOT NULL DEFAULT '{}',
    "kommentar" TEXT,
    "hochgeladenVonId" TEXT NOT NULL,
    "hochgeladenVon" TEXT NOT NULL,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_flash_dokument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kunde_region_kunde_key" ON "kunde_region"("kunde");

-- CreateIndex
CREATE INDEX "kunde_region_regionCode_idx" ON "kunde_region"("regionCode");

-- CreateIndex
CREATE INDEX "agm_statement_status_idx" ON "agm_statement"("status");

-- CreateIndex
CREATE INDEX "agm_statement_jahr_monat_idx" ON "agm_statement"("jahr", "monat");

-- CreateIndex
CREATE UNIQUE INDEX "agm_statement_periode_regionCode_key" ON "agm_statement"("periode", "regionCode");

-- CreateIndex
CREATE INDEX "sales_flash_dokument_jahr_monat_idx" ON "sales_flash_dokument"("jahr", "monat");

-- CreateIndex
CREATE UNIQUE INDEX "sales_flash_dokument_jahr_monat_key" ON "sales_flash_dokument"("jahr", "monat");

-- CreateIndex
CREATE INDEX "absatz_regionCode_idx" ON "absatz"("regionCode");
