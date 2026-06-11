-- CreateEnum
CREATE TYPE "Rolle" AS ENUM ('AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('EINGELADEN', 'VERIFIZIERT', 'DEAKTIVIERT');

-- CreateEnum
CREATE TYPE "Company" AS ENUM ('BBD', 'BBE', 'BBF', 'BMW');

-- CreateEnum
CREATE TYPE "E1Kategorie" AS ENUM ('IMPLANT', 'OPHTHALMO', 'AFTERLOADER', 'OTHER', 'ZENTRAL');

-- CreateEnum
CREATE TYPE "KennzahlTyp" AS ENUM ('REVENUE');

-- CreateEnum
CREATE TYPE "BudgetStatus" AS ENUM ('AKTIV', 'HISTORISIERT');

-- CreateEnum
CREATE TYPE "BudgetAenderungStatus" AS ENUM ('ENTWURF', 'BEANTRAGT', 'FREIGABE_VERTRIEBSLEITER', 'FREIGABE_BU_LEITER', 'ABGELEHNT', 'AKTIV');

-- CreateEnum
CREATE TYPE "ForecastStatus" AS ENUM ('OFFEN', 'BESTAETIGT', 'ANGEPASST', 'ZURUECKGEWIESEN', 'ABGESCHLOSSEN');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('HOCHGELADEN', 'VALIDIERT', 'ABGESCHLOSSEN', 'FEHLGESCHLAGEN');

-- CreateEnum
CREATE TYPE "QuarantaeneStatus" AS ENUM ('OFFEN', 'GEKLAERT', 'VERWORFEN');

-- CreateEnum
CREATE TYPE "QuarantaeneGrund" AS ENUM ('UNBEKANNTE_KOSTENSTELLE', 'LAND_LEER', 'UNBEKANNTES_LAND', 'UNBEKANNTER_LANDNAME', 'UNBEKANNTE_E1', 'UNBEKANNTE_E2', 'WERT_LEER', 'VORZEICHEN_INKONSISTENT', 'UNBEKANNTER_MONAT', 'RECID_DUP_IN_DATEI', 'COMPANY_UNBEKANNT');

-- CreateEnum
CREATE TYPE "AuditAktion" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'STATUS_WECHSEL', 'IMPORT', 'EXPORT', 'LOGIN', 'LOGIN_FEHLER', 'MAIL_FEHLER');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwortHash" TEXT,
    "rolle" "Rolle" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'EINGELADEN',
    "passwortWechselPflicht" BOOLEAN NOT NULL DEFAULT false,
    "einladungTokenHash" TEXT,
    "einladungAblauf" TIMESTAMP(3),
    "resetTokenHash" TEXT,
    "resetAblauf" TIMESTAMP(3),
    "fehlversuche" INTEGER NOT NULL DEFAULT 0,
    "gesperrtBis" TIMESTAMP(3),
    "letzterLogin" TIMESTAMP(3),
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "region" (
    "code" TEXT NOT NULL,
    "bezeichnung" TEXT NOT NULL,
    "forecastRelevant" BOOLEAN NOT NULL DEFAULT true,
    "synonyme" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "region_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "kostenstelle" (
    "id" TEXT NOT NULL,
    "nummer" TEXT NOT NULL,
    "bezeichnung" TEXT NOT NULL,
    "company" "Company" NOT NULL,
    "istSammel" BOOLEAN NOT NULL DEFAULT false,
    "regionCode" TEXT NOT NULL,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kostenstelle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regions_verantwortung" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "regionCode" TEXT NOT NULL,
    "gueltigVon" TIMESTAMP(3) NOT NULL,
    "gueltigBis" TIMESTAMP(3),
    "geloeschtAm" TIMESTAMP(3),
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regions_verantwortung_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "land" (
    "isoCode" TEXT NOT NULL,
    "nameDe" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "land_pkey" PRIMARY KEY ("isoCode")
);

-- CreateTable
CREATE TABLE "produktgruppe_e1" (
    "id" TEXT NOT NULL,
    "kategorie" "E1Kategorie" NOT NULL,
    "nameDe" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "synonyme" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortierung" INTEGER NOT NULL DEFAULT 0,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "produktgruppe_e1_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produktgruppe_e2" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "e1Id" TEXT NOT NULL,
    "synonyme" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "istPlatzhalter" BOOLEAN NOT NULL DEFAULT false,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "produktgruppe_e2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ist_umsatz" (
    "id" TEXT NOT NULL,
    "recid" TEXT NOT NULL,
    "dataareaid" TEXT NOT NULL,
    "buchungsdatum" TIMESTAMP(3) NOT NULL,
    "jahr" INTEGER NOT NULL,
    "monat" INTEGER NOT NULL,
    "kostenstelleId" TEXT NOT NULL,
    "landId" TEXT,
    "e1Id" TEXT NOT NULL,
    "e2Id" TEXT,
    "kostentraeger" TEXT,
    "sachkonto" TEXT,
    "postingtype" TEXT,
    "wertEur" DECIMAL(15,2) NOT NULL,
    "kennzahlTyp" "KennzahlTyp" NOT NULL DEFAULT 'REVENUE',
    "istSondereffekt" BOOLEAN NOT NULL DEFAULT false,
    "sondereffektGrund" TEXT,
    "importBatchId" TEXT NOT NULL,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ist_umsatz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget" (
    "id" TEXT NOT NULL,
    "jahr" INTEGER NOT NULL,
    "monat" INTEGER,
    "regionCode" TEXT NOT NULL,
    "landId" TEXT,
    "e1Id" TEXT NOT NULL,
    "e2Id" TEXT,
    "company" "Company" NOT NULL,
    "kostentraeger" TEXT,
    "wertEur" DECIMAL(15,2),
    "units" DECIMAL(15,2),
    "asp" DECIMAL(15,4),
    "kennzahlTyp" "KennzahlTyp" NOT NULL DEFAULT 'REVENUE',
    "istRegionsreserve" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "BudgetStatus" NOT NULL DEFAULT 'AKTIV',
    "importBatchId" TEXT,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_aenderung" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT,
    "antragstellerId" TEXT NOT NULL,
    "jahr" INTEGER NOT NULL,
    "regionCode" TEXT NOT NULL,
    "landId" TEXT,
    "e1Id" TEXT NOT NULL,
    "altWertEur" DECIMAL(15,2),
    "neuWertEur" DECIMAL(15,2) NOT NULL,
    "altUnits" DECIMAL(15,2),
    "neuUnits" DECIMAL(15,2),
    "begruendung" TEXT NOT NULL,
    "status" "BudgetAenderungStatus" NOT NULL DEFAULT 'ENTWURF',
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_aenderung_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_aenderung_event" (
    "id" TEXT NOT NULL,
    "aenderungId" TEXT NOT NULL,
    "vonStatus" "BudgetAenderungStatus",
    "nachStatus" "BudgetAenderungStatus" NOT NULL,
    "byUserId" TEXT NOT NULL,
    "begruendung" TEXT,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_aenderung_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forecast_periode" (
    "id" TEXT NOT NULL,
    "periode" TEXT NOT NULL,
    "jahr" INTEGER NOT NULL,
    "monat" INTEGER NOT NULL,
    "regionCode" TEXT NOT NULL,
    "status" "ForecastStatus" NOT NULL DEFAULT 'OFFEN',
    "deadline" TIMESTAMP(3) NOT NULL,
    "benachrichtigtAm" TIMESTAMP(3),
    "erinnerungAm" TIMESTAMP(3),
    "eskalationAm" TIMESTAMP(3),
    "abgeschlossenAm" TIMESTAMP(3),
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forecast_periode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forecast_version" (
    "id" TEXT NOT NULL,
    "periode" TEXT NOT NULL,
    "jahr" INTEGER NOT NULL,
    "monat" INTEGER NOT NULL,
    "regionCode" TEXT NOT NULL,
    "landId" TEXT NOT NULL,
    "e1Id" TEXT NOT NULL,
    "monatswerteRest" JSONB NOT NULL,
    "status" "ForecastStatus" NOT NULL,
    "kommentar" TEXT,
    "schwellwertVerletzt" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forecast_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batch" (
    "id" TEXT NOT NULL,
    "typ" TEXT NOT NULL,
    "dateiname" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "monatAbgeschlossen" BOOLEAN NOT NULL DEFAULT false,
    "zeilenGesamt" INTEGER NOT NULL DEFAULT 0,
    "zeilenNeu" INTEGER NOT NULL DEFAULT 0,
    "zeilenAktualisiert" INTEGER NOT NULL DEFAULT 0,
    "zeilenUebersprungen" INTEGER NOT NULL DEFAULT 0,
    "zeilenQuarantaene" INTEGER NOT NULL DEFAULT 0,
    "validierungsbericht" JSONB,
    "status" "ImportStatus" NOT NULL DEFAULT 'HOCHGELADEN',
    "ausgeloestVonId" TEXT NOT NULL,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "abgeschlossenAm" TIMESTAMP(3),

    CONSTRAINT "import_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_quarantaene" (
    "id" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "zeilenNummer" INTEGER NOT NULL,
    "recid" TEXT,
    "rohdaten" JSONB NOT NULL,
    "grund" "QuarantaeneGrund" NOT NULL,
    "detail" TEXT,
    "status" "QuarantaeneStatus" NOT NULL DEFAULT 'OFFEN',
    "geklaertVonId" TEXT,
    "geklaertAm" TIMESTAMP(3),
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_quarantaene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_trail" (
    "id" TEXT NOT NULL,
    "entitaet" TEXT NOT NULL,
    "entitaetId" TEXT,
    "aktion" "AuditAktion" NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT,
    "vorherWert" JSONB,
    "nachherWert" JSONB,
    "ipAdresse" TEXT,
    "metadaten" JSONB,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_trail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "einstellung" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "beschreibung" TEXT,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,
    "aktualisiertVonId" TEXT,

    CONSTRAINT "einstellung_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "sondereffekt" (
    "id" TEXT NOT NULL,
    "jahr" INTEGER NOT NULL,
    "monat" INTEGER,
    "regionCode" TEXT,
    "landId" TEXT,
    "e1Id" TEXT,
    "betragEur" DECIMAL(15,2) NOT NULL,
    "beschreibung" TEXT NOT NULL,
    "istEinmaleffekt" BOOLEAN NOT NULL DEFAULT true,
    "erstelltVonId" TEXT NOT NULL,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sondereffekt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_einladungTokenHash_key" ON "user"("einladungTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "user_resetTokenHash_key" ON "user"("resetTokenHash");

-- CreateIndex
CREATE INDEX "user_rolle_idx" ON "user"("rolle");

-- CreateIndex
CREATE INDEX "user_status_idx" ON "user"("status");

-- CreateIndex
CREATE UNIQUE INDEX "kostenstelle_nummer_key" ON "kostenstelle"("nummer");

-- CreateIndex
CREATE INDEX "kostenstelle_regionCode_idx" ON "kostenstelle"("regionCode");

-- CreateIndex
CREATE INDEX "kostenstelle_company_idx" ON "kostenstelle"("company");

-- CreateIndex
CREATE INDEX "regions_verantwortung_userId_idx" ON "regions_verantwortung"("userId");

-- CreateIndex
CREATE INDEX "regions_verantwortung_regionCode_idx" ON "regions_verantwortung"("regionCode");

-- CreateIndex
CREATE INDEX "regions_verantwortung_gueltigVon_gueltigBis_idx" ON "regions_verantwortung"("gueltigVon", "gueltigBis");

-- CreateIndex
CREATE INDEX "land_nameEn_idx" ON "land"("nameEn");

-- CreateIndex
CREATE UNIQUE INDEX "produktgruppe_e1_kategorie_key" ON "produktgruppe_e1"("kategorie");

-- CreateIndex
CREATE UNIQUE INDEX "produktgruppe_e2_name_key" ON "produktgruppe_e2"("name");

-- CreateIndex
CREATE INDEX "produktgruppe_e2_e1Id_idx" ON "produktgruppe_e2"("e1Id");

-- CreateIndex
CREATE UNIQUE INDEX "ist_umsatz_recid_key" ON "ist_umsatz"("recid");

-- CreateIndex
CREATE INDEX "ist_umsatz_jahr_monat_idx" ON "ist_umsatz"("jahr", "monat");

-- CreateIndex
CREATE INDEX "ist_umsatz_kostenstelleId_idx" ON "ist_umsatz"("kostenstelleId");

-- CreateIndex
CREATE INDEX "ist_umsatz_landId_idx" ON "ist_umsatz"("landId");

-- CreateIndex
CREATE INDEX "ist_umsatz_e1Id_idx" ON "ist_umsatz"("e1Id");

-- CreateIndex
CREATE INDEX "ist_umsatz_importBatchId_idx" ON "ist_umsatz"("importBatchId");

-- CreateIndex
CREATE INDEX "ist_umsatz_kostenstelleId_landId_e1Id_jahr_monat_idx" ON "ist_umsatz"("kostenstelleId", "landId", "e1Id", "jahr", "monat");

-- CreateIndex
CREATE INDEX "budget_jahr_monat_idx" ON "budget"("jahr", "monat");

-- CreateIndex
CREATE INDEX "budget_regionCode_idx" ON "budget"("regionCode");

-- CreateIndex
CREATE INDEX "budget_landId_idx" ON "budget"("landId");

-- CreateIndex
CREATE INDEX "budget_e1Id_idx" ON "budget"("e1Id");

-- CreateIndex
CREATE INDEX "budget_status_idx" ON "budget"("status");

-- CreateIndex
CREATE INDEX "budget_jahr_regionCode_landId_e1Id_status_idx" ON "budget"("jahr", "regionCode", "landId", "e1Id", "status");

-- CreateIndex
CREATE INDEX "budget_aenderung_status_idx" ON "budget_aenderung"("status");

-- CreateIndex
CREATE INDEX "budget_aenderung_regionCode_idx" ON "budget_aenderung"("regionCode");

-- CreateIndex
CREATE INDEX "budget_aenderung_antragstellerId_idx" ON "budget_aenderung"("antragstellerId");

-- CreateIndex
CREATE INDEX "budget_aenderung_event_aenderungId_idx" ON "budget_aenderung_event"("aenderungId");

-- CreateIndex
CREATE INDEX "forecast_periode_status_idx" ON "forecast_periode"("status");

-- CreateIndex
CREATE INDEX "forecast_periode_jahr_monat_idx" ON "forecast_periode"("jahr", "monat");

-- CreateIndex
CREATE UNIQUE INDEX "forecast_periode_periode_regionCode_key" ON "forecast_periode"("periode", "regionCode");

-- CreateIndex
CREATE INDEX "forecast_version_periode_regionCode_idx" ON "forecast_version"("periode", "regionCode");

-- CreateIndex
CREATE INDEX "forecast_version_regionCode_landId_e1Id_idx" ON "forecast_version"("regionCode", "landId", "e1Id");

-- CreateIndex
CREATE INDEX "forecast_version_periode_regionCode_landId_e1Id_version_idx" ON "forecast_version"("periode", "regionCode", "landId", "e1Id", "version");

-- CreateIndex
CREATE INDEX "import_batch_hash_idx" ON "import_batch"("hash");

-- CreateIndex
CREATE INDEX "import_batch_status_idx" ON "import_batch"("status");

-- CreateIndex
CREATE INDEX "import_quarantaene_importBatchId_idx" ON "import_quarantaene"("importBatchId");

-- CreateIndex
CREATE INDEX "import_quarantaene_status_idx" ON "import_quarantaene"("status");

-- CreateIndex
CREATE INDEX "audit_trail_entitaet_entitaetId_idx" ON "audit_trail"("entitaet", "entitaetId");

-- CreateIndex
CREATE INDEX "audit_trail_userId_idx" ON "audit_trail"("userId");

-- CreateIndex
CREATE INDEX "audit_trail_aktion_idx" ON "audit_trail"("aktion");

-- CreateIndex
CREATE INDEX "audit_trail_erstelltAm_idx" ON "audit_trail"("erstelltAm");

-- CreateIndex
CREATE INDEX "sondereffekt_jahr_monat_idx" ON "sondereffekt"("jahr", "monat");

-- CreateIndex
CREATE INDEX "sondereffekt_regionCode_idx" ON "sondereffekt"("regionCode");

-- AddForeignKey
ALTER TABLE "kostenstelle" ADD CONSTRAINT "kostenstelle_regionCode_fkey" FOREIGN KEY ("regionCode") REFERENCES "region"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regions_verantwortung" ADD CONSTRAINT "regions_verantwortung_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regions_verantwortung" ADD CONSTRAINT "regions_verantwortung_regionCode_fkey" FOREIGN KEY ("regionCode") REFERENCES "region"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produktgruppe_e2" ADD CONSTRAINT "produktgruppe_e2_e1Id_fkey" FOREIGN KEY ("e1Id") REFERENCES "produktgruppe_e1"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ist_umsatz" ADD CONSTRAINT "ist_umsatz_kostenstelleId_fkey" FOREIGN KEY ("kostenstelleId") REFERENCES "kostenstelle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ist_umsatz" ADD CONSTRAINT "ist_umsatz_landId_fkey" FOREIGN KEY ("landId") REFERENCES "land"("isoCode") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ist_umsatz" ADD CONSTRAINT "ist_umsatz_e1Id_fkey" FOREIGN KEY ("e1Id") REFERENCES "produktgruppe_e1"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ist_umsatz" ADD CONSTRAINT "ist_umsatz_e2Id_fkey" FOREIGN KEY ("e2Id") REFERENCES "produktgruppe_e2"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ist_umsatz" ADD CONSTRAINT "ist_umsatz_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget" ADD CONSTRAINT "budget_regionCode_fkey" FOREIGN KEY ("regionCode") REFERENCES "region"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget" ADD CONSTRAINT "budget_landId_fkey" FOREIGN KEY ("landId") REFERENCES "land"("isoCode") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget" ADD CONSTRAINT "budget_e1Id_fkey" FOREIGN KEY ("e1Id") REFERENCES "produktgruppe_e1"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget" ADD CONSTRAINT "budget_e2Id_fkey" FOREIGN KEY ("e2Id") REFERENCES "produktgruppe_e2"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_aenderung" ADD CONSTRAINT "budget_aenderung_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "budget"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_aenderung" ADD CONSTRAINT "budget_aenderung_antragstellerId_fkey" FOREIGN KEY ("antragstellerId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_aenderung" ADD CONSTRAINT "budget_aenderung_regionCode_fkey" FOREIGN KEY ("regionCode") REFERENCES "region"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_aenderung" ADD CONSTRAINT "budget_aenderung_landId_fkey" FOREIGN KEY ("landId") REFERENCES "land"("isoCode") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_aenderung" ADD CONSTRAINT "budget_aenderung_e1Id_fkey" FOREIGN KEY ("e1Id") REFERENCES "produktgruppe_e1"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_aenderung_event" ADD CONSTRAINT "budget_aenderung_event_aenderungId_fkey" FOREIGN KEY ("aenderungId") REFERENCES "budget_aenderung"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_aenderung_event" ADD CONSTRAINT "budget_aenderung_event_byUserId_fkey" FOREIGN KEY ("byUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_periode" ADD CONSTRAINT "forecast_periode_regionCode_fkey" FOREIGN KEY ("regionCode") REFERENCES "region"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_version" ADD CONSTRAINT "forecast_version_regionCode_fkey" FOREIGN KEY ("regionCode") REFERENCES "region"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_version" ADD CONSTRAINT "forecast_version_landId_fkey" FOREIGN KEY ("landId") REFERENCES "land"("isoCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_version" ADD CONSTRAINT "forecast_version_e1Id_fkey" FOREIGN KEY ("e1Id") REFERENCES "produktgruppe_e1"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_version" ADD CONSTRAINT "forecast_version_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_ausgeloestVonId_fkey" FOREIGN KEY ("ausgeloestVonId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_quarantaene" ADD CONSTRAINT "import_quarantaene_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sondereffekt" ADD CONSTRAINT "sondereffekt_erstelltVonId_fkey" FOREIGN KEY ("erstelltVonId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
