-- CreateEnum
CREATE TYPE "VoiceStatus" AS ENUM ('TRANSKRIBIERT', 'EXTRAHIERT', 'BESTAETIGT', 'VERWORFEN');

-- CreateTable
CREATE TABLE "voice_session" (
    "id" TEXT NOT NULL,
    "periode" TEXT NOT NULL,
    "regionCode" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "sprache" TEXT,
    "status" "VoiceStatus" NOT NULL DEFAULT 'TRANSKRIBIERT',
    "audio" BYTEA,
    "audioMimeType" TEXT,
    "audioGroesse" INTEGER NOT NULL DEFAULT 0,
    "transkript" TEXT NOT NULL,
    "extraktion" JSONB,
    "sttProvider" TEXT,
    "llmModell" TEXT,
    "bestaetigtAm" TIMESTAMP(3),
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "voice_session_periode_regionCode_idx" ON "voice_session"("periode", "regionCode");

-- CreateIndex
CREATE INDEX "voice_session_status_idx" ON "voice_session"("status");

-- CreateIndex
CREATE INDEX "voice_session_erstelltAm_idx" ON "voice_session"("erstelltAm");
