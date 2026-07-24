-- CreateTable
CREATE TABLE "guv_position" (
    "id" TEXT NOT NULL,
    "jahr" INTEGER NOT NULL,
    "stichtagMonat" INTEGER NOT NULL,
    "positionKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortierung" INTEGER NOT NULL,
    "ebene" INTEGER NOT NULL,
    "istEur" DECIMAL(15,2) NOT NULL,
    "pyEur" DECIMAL(15,2) NOT NULL,
    "budEur" DECIMAL(15,2) NOT NULL,
    "importBatchId" TEXT,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guv_position_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guv_position_jahr_idx" ON "guv_position"("jahr");

-- CreateIndex
CREATE UNIQUE INDEX "guv_position_jahr_positionKey_key" ON "guv_position"("jahr", "positionKey");

-- AddForeignKey
ALTER TABLE "guv_position" ADD CONSTRAINT "guv_position_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
