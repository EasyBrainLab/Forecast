-- CreateTable
CREATE TABLE "competitor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aktiv" BOOLEAN NOT NULL DEFAULT true,
    "notiz" TEXT,
    "sortierung" INTEGER NOT NULL DEFAULT 0,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competitor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "competitor_name_key" ON "competitor"("name");

-- CreateIndex
CREATE INDEX "competitor_aktiv_idx" ON "competitor"("aktiv");
