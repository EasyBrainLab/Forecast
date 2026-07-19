-- AlterTable
ALTER TABLE "forecast_periode" ADD COLUMN     "fremdaenderungAm" TIMESTAMP(3),
ADD COLUMN     "fremdaenderungBegruendung" TEXT,
ADD COLUMN     "fremdaenderungQuittiertAm" TIMESTAMP(3),
ADD COLUMN     "fremdaenderungVon" TEXT;
