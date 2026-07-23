-- CreateTable
CREATE TABLE "sales_flash_detail" (
    "id" TEXT NOT NULL,
    "jahr" INTEGER NOT NULL,
    "monat" INTEGER NOT NULL,
    "regionCode" TEXT NOT NULL,
    "e1Id" TEXT NOT NULL,
    "landId" TEXT,
    "periodenMonat" INTEGER NOT NULL,
    "actualEur" DECIMAL(15,2) NOT NULL,
    "produktgruppeRoh" TEXT NOT NULL,
    "landRoh" TEXT NOT NULL,
    "dateiname" TEXT NOT NULL,
    "hochgeladenVon" TEXT NOT NULL,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_flash_detail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_flash_detail_jahr_monat_regionCode_idx" ON "sales_flash_detail"("jahr", "monat", "regionCode");

-- CreateIndex
CREATE UNIQUE INDEX "sales_flash_detail_jahr_monat_regionCode_e1Id_landId_period_key" ON "sales_flash_detail"("jahr", "monat", "regionCode", "e1Id", "landId", "periodenMonat");

-- AddForeignKey
ALTER TABLE "sales_flash_detail" ADD CONSTRAINT "sales_flash_detail_e1Id_fkey" FOREIGN KEY ("e1Id") REFERENCES "produktgruppe_e1"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_flash_detail" ADD CONSTRAINT "sales_flash_detail_landId_fkey" FOREIGN KEY ("landId") REFERENCES "land"("isoCode") ON DELETE SET NULL ON UPDATE CASCADE;
