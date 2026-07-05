-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('ENTWURF', 'IN_PRUEFUNG_KI', 'EINGEREICHT', 'GELESEN');

-- CreateEnum
CREATE TYPE "ReportAbschnitt" AS ENUM ('KRITISCH', 'IMPLANTATION', 'AKTIVITAET_NEUKUNDE', 'AKTIVITAET_BESTAND', 'MARKETING', 'PROJEKT', 'NAECHSTE_AKTIVITAET', 'WETTBEWERB');

-- CreateTable
CREATE TABLE "monthly_report" (
    "id" TEXT NOT NULL,
    "periode" TEXT NOT NULL,
    "jahr" INTEGER NOT NULL,
    "monat" INTEGER NOT NULL,
    "regionCode" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'ENTWURF',
    "forecastFolgemonatEur" DECIMAL(15,2),
    "forecastQuartalEur" DECIMAL(15,2),
    "wettbewerbKeineAenderung" BOOLEAN NOT NULL DEFAULT false,
    "marktAllgemein" TEXT,
    "personal" TEXT,
    "sonstiges" TEXT,
    "eingereichtAm" TIMESTAMP(3),
    "gelesenAm" TIMESTAMP(3),
    "gelesenVon" TEXT,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monthly_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_eintrag" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "abschnitt" "ReportAbschnitt" NOT NULL,
    "typ" TEXT,
    "customerSiteId" TEXT,
    "competitorId" TEXT,
    "tenderId" TEXT,
    "e1Id" TEXT,
    "datum" TIMESTAMP(3),
    "beschreibung" TEXT NOT NULL,
    "ergebnis" TEXT,
    "landIso" TEXT,
    "stadt" TEXT,
    "erwarteterUmsatzEur" DECIMAL(15,2),
    "wahrscheinlichkeit" INTEGER,
    "kostenEur" DECIMAL(15,2),
    "menge" DECIMAL(15,2),
    "preisInfo" TEXT,
    "sortierung" INTEGER NOT NULL DEFAULT 0,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_eintrag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "monthly_report_status_idx" ON "monthly_report"("status");

-- CreateIndex
CREATE INDEX "monthly_report_jahr_monat_idx" ON "monthly_report"("jahr", "monat");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_report_periode_regionCode_key" ON "monthly_report"("periode", "regionCode");

-- CreateIndex
CREATE INDEX "report_eintrag_reportId_idx" ON "report_eintrag"("reportId");

-- CreateIndex
CREATE INDEX "report_eintrag_abschnitt_idx" ON "report_eintrag"("abschnitt");

-- CreateIndex
CREATE INDEX "report_eintrag_customerSiteId_idx" ON "report_eintrag"("customerSiteId");

-- CreateIndex
CREATE INDEX "report_eintrag_tenderId_idx" ON "report_eintrag"("tenderId");

-- AddForeignKey
ALTER TABLE "report_eintrag" ADD CONSTRAINT "report_eintrag_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "monthly_report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_eintrag" ADD CONSTRAINT "report_eintrag_customerSiteId_fkey" FOREIGN KEY ("customerSiteId") REFERENCES "customer_site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_eintrag" ADD CONSTRAINT "report_eintrag_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "competitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_eintrag" ADD CONSTRAINT "report_eintrag_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "tender"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_eintrag" ADD CONSTRAINT "report_eintrag_e1Id_fkey" FOREIGN KEY ("e1Id") REFERENCES "produktgruppe_e1"("id") ON DELETE SET NULL ON UPDATE CASCADE;
