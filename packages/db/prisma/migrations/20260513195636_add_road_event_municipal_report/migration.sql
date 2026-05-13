-- CreateEnum
CREATE TYPE "MunicipalReportStatus" AS ENUM ('not_submitted', 'queued', 'submitted', 'acknowledged', 'resolved');

-- AlterTable
ALTER TABLE "RoadEvent" ADD COLUMN     "municipalStatus" "MunicipalReportStatus" NOT NULL DEFAULT 'not_submitted',
ADD COLUMN     "note" TEXT,
ADD COLUMN     "photoLocalUri" TEXT,
ADD COLUMN     "photoStorageKey" TEXT;

-- CreateIndex
CREATE INDEX "RoadEvent_municipalStatus_idx" ON "RoadEvent"("municipalStatus");
