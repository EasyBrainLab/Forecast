-- CreateTable
CREATE TABLE "absatz" (
    "id" TEXT NOT NULL,
    "jahr" INTEGER NOT NULL,
    "bisMonat" INTEGER NOT NULL,
    "landId" TEXT NOT NULL,
    "kunde" TEXT NOT NULL,
    "stadt" TEXT,
    "seeds" DECIMAL(15,2) NOT NULL,
    "seedsVorjahr" DECIMAL(15,2) NOT NULL,
    "ruthen" DECIMAL(15,2) NOT NULL,
    "ruthenVorjahr" DECIMAL(15,2) NOT NULL,
    "icTotal" DECIMAL(15,2) NOT NULL,
    "isTotal" DECIMAL(15,2) NOT NULL,
    "s16" DECIMAL(15,2) NOT NULL,
    "s16Vorjahr" DECIMAL(15,2) NOT NULL,
    "details" JSONB NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "absatz_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "absatz_jahr_bisMonat_idx" ON "absatz"("jahr", "bisMonat");

-- CreateIndex
CREATE INDEX "absatz_landId_idx" ON "absatz"("landId");

-- AddForeignKey
ALTER TABLE "absatz" ADD CONSTRAINT "absatz_landId_fkey" FOREIGN KEY ("landId") REFERENCES "land"("isoCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absatz" ADD CONSTRAINT "absatz_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
