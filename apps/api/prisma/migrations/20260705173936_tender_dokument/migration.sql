-- CreateEnum
CREATE TYPE "TenderDokumentStatus" AS ENUM ('HOCHGELADEN', 'ANALYSIERT', 'UEBERNOMMEN', 'VERWORFEN');

-- CreateTable
CREATE TABLE "tender_dokument" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT,
    "dateiname" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "groesseBytes" INTEGER NOT NULL,
    "inhalt" BYTEA NOT NULL,
    "status" "TenderDokumentStatus" NOT NULL DEFAULT 'HOCHGELADEN',
    "analyse" JSONB,
    "llmModell" TEXT,
    "hochgeladenVonId" TEXT NOT NULL,
    "hochgeladenVon" TEXT NOT NULL,
    "regionCode" TEXT,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tender_dokument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tender_dokument_tenderId_idx" ON "tender_dokument"("tenderId");

-- CreateIndex
CREATE INDEX "tender_dokument_status_idx" ON "tender_dokument"("status");

-- CreateIndex
CREATE INDEX "tender_dokument_hochgeladenVonId_idx" ON "tender_dokument"("hochgeladenVonId");

-- AddForeignKey
ALTER TABLE "tender_dokument" ADD CONSTRAINT "tender_dokument_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "tender"("id") ON DELETE SET NULL ON UPDATE CASCADE;
