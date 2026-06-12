-- CreateTable
CREATE TABLE "perioden_abschluss" (
    "id" TEXT NOT NULL,
    "jahr" INTEGER NOT NULL,
    "monat" INTEGER NOT NULL,
    "abgeschlossen" BOOLEAN NOT NULL DEFAULT false,
    "abgeschlossenVon" TEXT,
    "abgeschlossenAm" TIMESTAMP(3),
    "notiz" TEXT,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perioden_abschluss_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "perioden_abschluss_jahr_monat_key" ON "perioden_abschluss"("jahr", "monat");

-- Einstellungen: Ist-Quelle (Wahrheits-Hierarchie) + Abgleich-Toleranz (idempotent, überschreibt bestehende Werte nicht)
INSERT INTO "einstellung" ("key", "value", "beschreibung", "aktualisiertAm")
VALUES
  ('IST_QUELLE', 'SALES_FLASH', 'Maßgebliche Ist-Umsatzquelle: SALES_FLASH (verifiziertes Controlling-Ist) oder GL (External Revenue)', CURRENT_TIMESTAMP),
  ('ABGLEICH_TOLERANZ_PROZENT', '2', 'Toleranzband für den Abgleich GL-Ist gegen Sales-Flash-Ist (in %)', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
