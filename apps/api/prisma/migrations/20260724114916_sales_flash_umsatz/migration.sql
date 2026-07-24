-- CreateTable
CREATE TABLE "sales_flash_umsatz" (
    "id" TEXT NOT NULL,
    "jahr" INTEGER NOT NULL,
    "monat" INTEGER NOT NULL,
    "dataAreaId" TEXT NOT NULL,
    "debitornr" TEXT NOT NULL,
    "kundenname" TEXT NOT NULL,
    "articleNr" TEXT,
    "articleName" TEXT,
    "kostenstelle" TEXT,
    "kostentraeger" TEXT,
    "e1Kategorie" TEXT,
    "e2Name" TEXT,
    "regionCode" TEXT,
    "landIso" TEXT,
    "rechnungsnr" TEXT,
    "projektnummer" TEXT,
    "betragEur" DECIMAL(15,2) NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_flash_umsatz_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_flash_umsatz_jahr_monat_idx" ON "sales_flash_umsatz"("jahr", "monat");

-- CreateIndex
CREATE INDEX "sales_flash_umsatz_dataAreaId_debitornr_idx" ON "sales_flash_umsatz"("dataAreaId", "debitornr");

-- CreateIndex
CREATE INDEX "sales_flash_umsatz_articleNr_idx" ON "sales_flash_umsatz"("articleNr");

-- CreateIndex
CREATE INDEX "sales_flash_umsatz_regionCode_idx" ON "sales_flash_umsatz"("regionCode");

-- AddForeignKey
ALTER TABLE "sales_flash_umsatz" ADD CONSTRAINT "sales_flash_umsatz_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

