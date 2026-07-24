/*
  Warnings:

  - You are about to drop the `pl_kosten` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "pl_kosten" DROP CONSTRAINT "pl_kosten_importBatchId_fkey";

-- DropTable
DROP TABLE "pl_kosten";

-- DropEnum
DROP TYPE "PlArt";
