-- CreateTable
CREATE TABLE "liefermenge" (
    "id" TEXT NOT NULL,
    "jahr" INTEGER NOT NULL,
    "monat" INTEGER NOT NULL,
    "shippingDate" TIMESTAMP(3) NOT NULL,
    "auftragsnummer" TEXT NOT NULL,
    "kunde" TEXT NOT NULL,
    "landId" TEXT,
    "regionCode" TEXT,
    "e1Id" TEXT NOT NULL,
    "e2Id" TEXT,
    "produktgruppeRoh" TEXT NOT NULL,
    "unterkategorieRoh" TEXT NOT NULL,
    "itemNumber" TEXT NOT NULL,
    "stueckzahl" DECIMAL(15,2) NOT NULL,
    "seedzahl" DECIMAL(15,2) NOT NULL,
    "orderedQty" DECIMAL(15,2),
    "lineAmountEur" DECIMAL(15,2),
    "kostenstelleRoh" TEXT,
    "kostentraeger" TEXT,
    "dataAreaId" TEXT,
    "importBatchId" TEXT NOT NULL,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liefermenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "liefermenge_jahr_monat_idx" ON "liefermenge"("jahr", "monat");

-- CreateIndex
CREATE INDEX "liefermenge_regionCode_idx" ON "liefermenge"("regionCode");

-- CreateIndex
CREATE INDEX "liefermenge_landId_idx" ON "liefermenge"("landId");

-- CreateIndex
CREATE INDEX "liefermenge_e1Id_idx" ON "liefermenge"("e1Id");

-- CreateIndex
CREATE INDEX "liefermenge_kunde_idx" ON "liefermenge"("kunde");

-- CreateIndex
CREATE INDEX "liefermenge_importBatchId_idx" ON "liefermenge"("importBatchId");

-- AddForeignKey
ALTER TABLE "liefermenge" ADD CONSTRAINT "liefermenge_landId_fkey" FOREIGN KEY ("landId") REFERENCES "land"("isoCode") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liefermenge" ADD CONSTRAINT "liefermenge_e1Id_fkey" FOREIGN KEY ("e1Id") REFERENCES "produktgruppe_e1"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liefermenge" ADD CONSTRAINT "liefermenge_e2Id_fkey" FOREIGN KEY ("e2Id") REFERENCES "produktgruppe_e2"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liefermenge" ADD CONSTRAINT "liefermenge_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
