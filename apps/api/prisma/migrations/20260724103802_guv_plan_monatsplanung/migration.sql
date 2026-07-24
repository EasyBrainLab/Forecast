-- DropIndex
DROP INDEX "guv_position_jahr_positionKey_key";

-- CreateTable
CREATE TABLE "guv_plan" (
    "id" TEXT NOT NULL,
    "jahr" INTEGER NOT NULL,
    "monat" INTEGER NOT NULL,
    "grossMarginPct" DECIMAL(6,3),
    "otherCostsEur" DECIMAL(15,2),
    "fteAnzahl" DECIMAL(8,2),
    "aktualisiertVon" TEXT,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guv_plan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guv_plan_jahr_idx" ON "guv_plan"("jahr");

-- CreateIndex
CREATE UNIQUE INDEX "guv_plan_jahr_monat_key" ON "guv_plan"("jahr", "monat");

-- CreateIndex
CREATE UNIQUE INDEX "guv_position_jahr_stichtagMonat_positionKey_key" ON "guv_position"("jahr", "stichtagMonat", "positionKey");

