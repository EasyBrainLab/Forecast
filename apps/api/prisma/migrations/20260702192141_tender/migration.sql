-- CreateEnum
CREATE TYPE "TenderStatus" AS ENUM ('BEOBACHTET', 'EINGEREICHT', 'GEWONNEN', 'VERLOREN', 'STORNIERT');

-- CreateTable
CREATE TABLE "tender" (
    "id" TEXT NOT NULL,
    "referenznummer" TEXT NOT NULL,
    "krankenhaus" TEXT NOT NULL,
    "stadt" TEXT,
    "landIso" TEXT,
    "regionCode" TEXT,
    "veroeffentlichtAm" TIMESTAMP(3),
    "abgabefrist" TIMESTAMP(3) NOT NULL,
    "status" "TenderStatus" NOT NULL DEFAULT 'BEOBACHTET',
    "wettbewerber" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "eigenerPreisEur" DECIMAL(15,2),
    "wettbewerbPreisEur" DECIMAL(15,2),
    "notiz" TEXT,
    "erstelltVonId" TEXT NOT NULL,
    "erstelltVon" TEXT NOT NULL,
    "reminderSchwelleTage" INTEGER,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_los" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "bezeichnung" TEXT NOT NULL,
    "volumenEur" DECIMAL(15,2),
    "menge" DECIMAL(15,2),
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tender_los_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tender_status_idx" ON "tender"("status");

-- CreateIndex
CREATE INDEX "tender_abgabefrist_idx" ON "tender"("abgabefrist");

-- CreateIndex
CREATE INDEX "tender_regionCode_idx" ON "tender"("regionCode");

-- CreateIndex
CREATE INDEX "tender_los_tenderId_idx" ON "tender_los"("tenderId");

-- AddForeignKey
ALTER TABLE "tender_los" ADD CONSTRAINT "tender_los_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;
