-- CreateEnum
CREATE TYPE "PlArt" AS ENUM ('ACTUAL', 'BUDGET');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "KennzahlTyp" ADD VALUE 'COGS';
ALTER TYPE "KennzahlTyp" ADD VALUE 'OTHER_COSTS';

-- CreateTable
CREATE TABLE "pl_kosten" (
    "id" TEXT NOT NULL,
    "jahr" INTEGER NOT NULL,
    "monat" INTEGER NOT NULL,
    "art" "PlArt" NOT NULL,
    "kennzahlTyp" "KennzahlTyp" NOT NULL,
    "eur" DECIMAL(15,2) NOT NULL,
    "importBatchId" TEXT,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pl_kosten_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pl_kosten_jahr_idx" ON "pl_kosten"("jahr");

-- CreateIndex
CREATE UNIQUE INDEX "pl_kosten_jahr_monat_art_kennzahlTyp_key" ON "pl_kosten"("jahr", "monat", "art", "kennzahlTyp");

-- AddForeignKey
ALTER TABLE "pl_kosten" ADD CONSTRAINT "pl_kosten_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
