-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "QuarantaeneGrund" ADD VALUE 'RECID_LEER';
ALTER TYPE "QuarantaeneGrund" ADD VALUE 'SCHLUESSEL_LEER';
ALTER TYPE "QuarantaeneGrund" ADD VALUE 'SCHLUESSEL_DUP_IN_DATEI';
ALTER TYPE "QuarantaeneGrund" ADD VALUE 'RECHNUNG_OHNE_KOPF';
ALTER TYPE "QuarantaeneGrund" ADD VALUE 'DATUM_UNGUELTIG';

-- CreateTable
CREATE TABLE "kundenstamm" (
    "id" TEXT NOT NULL,
    "kundennummer" TEXT NOT NULL,
    "dataAreaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kundengruppe" TEXT,
    "landIso" TEXT,
    "stadt" TEXT,
    "plz" TEXT,
    "strasse" TEXT,
    "waehrung" TEXT,
    "typ" TEXT,
    "rohdaten" JSONB NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kundenstamm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verkaufsrechnung" (
    "id" TEXT NOT NULL,
    "recid" TEXT NOT NULL,
    "rechnungsnummer" TEXT NOT NULL,
    "dataAreaId" TEXT NOT NULL,
    "kundennummer" TEXT NOT NULL,
    "rechnungsdatum" TIMESTAMP(3) NOT NULL,
    "waehrung" TEXT NOT NULL,
    "betragGesamt" DECIMAL(15,2) NOT NULL,
    "landIso" TEXT,
    "stadt" TEXT,
    "importBatchId" TEXT NOT NULL,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verkaufsrechnung_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verkaufsrechnung_position" (
    "id" TEXT NOT NULL,
    "recid" TEXT NOT NULL,
    "rechnungsnummer" TEXT NOT NULL,
    "dataAreaId" TEXT NOT NULL,
    "kundennummer" TEXT NOT NULL,
    "rechnungsdatum" TIMESTAMP(3) NOT NULL,
    "produktnummer" TEXT,
    "produktname" TEXT,
    "menge" DECIMAL(15,2) NOT NULL,
    "verkaufspreis" DECIMAL(15,4) NOT NULL,
    "betrag" DECIMAL(15,2) NOT NULL,
    "waehrung" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verkaufsrechnung_position_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kundenstamm_landIso_idx" ON "kundenstamm"("landIso");

-- CreateIndex
CREATE INDEX "kundenstamm_kundengruppe_idx" ON "kundenstamm"("kundengruppe");

-- CreateIndex
CREATE UNIQUE INDEX "kundenstamm_dataAreaId_kundennummer_key" ON "kundenstamm"("dataAreaId", "kundennummer");

-- CreateIndex
CREATE UNIQUE INDEX "verkaufsrechnung_recid_key" ON "verkaufsrechnung"("recid");

-- CreateIndex
CREATE INDEX "verkaufsrechnung_kundennummer_idx" ON "verkaufsrechnung"("kundennummer");

-- CreateIndex
CREATE INDEX "verkaufsrechnung_rechnungsdatum_idx" ON "verkaufsrechnung"("rechnungsdatum");

-- CreateIndex
CREATE UNIQUE INDEX "verkaufsrechnung_dataAreaId_rechnungsnummer_key" ON "verkaufsrechnung"("dataAreaId", "rechnungsnummer");

-- CreateIndex
CREATE UNIQUE INDEX "verkaufsrechnung_position_recid_key" ON "verkaufsrechnung_position"("recid");

-- CreateIndex
CREATE INDEX "verkaufsrechnung_position_kundennummer_produktnummer_rechnu_idx" ON "verkaufsrechnung_position"("kundennummer", "produktnummer", "rechnungsdatum");

-- CreateIndex
CREATE INDEX "verkaufsrechnung_position_produktnummer_idx" ON "verkaufsrechnung_position"("produktnummer");

-- CreateIndex
CREATE INDEX "verkaufsrechnung_position_dataAreaId_rechnungsnummer_idx" ON "verkaufsrechnung_position"("dataAreaId", "rechnungsnummer");

-- AddForeignKey
ALTER TABLE "kundenstamm" ADD CONSTRAINT "kundenstamm_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verkaufsrechnung" ADD CONSTRAINT "verkaufsrechnung_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verkaufsrechnung_position" ADD CONSTRAINT "verkaufsrechnung_position_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
