-- CreateEnum
CREATE TYPE "MediaClipStatus" AS ENUM ('pending_upload', 'uploaded', 'failed');

-- CreateTable
CREATE TABLE "MediaClip" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "roadEventId" TEXT,
    "status" "MediaClipStatus" NOT NULL DEFAULT 'pending_upload',
    "localUri" TEXT,
    "storageKey" TEXT,
    "mimeType" TEXT NOT NULL DEFAULT 'video/mp4',
    "durationSeconds" DOUBLE PRECISION,
    "sizeBytes" INTEGER,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaClip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaClip_userId_idx" ON "MediaClip"("userId");

-- CreateIndex
CREATE INDEX "MediaClip_tripId_idx" ON "MediaClip"("tripId");

-- CreateIndex
CREATE INDEX "MediaClip_roadEventId_idx" ON "MediaClip"("roadEventId");

-- CreateIndex
CREATE INDEX "MediaClip_status_idx" ON "MediaClip"("status");

-- CreateIndex
CREATE INDEX "MediaClip_createdAt_idx" ON "MediaClip"("createdAt");

-- AddForeignKey
ALTER TABLE "MediaClip" ADD CONSTRAINT "MediaClip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaClip" ADD CONSTRAINT "MediaClip_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaClip" ADD CONSTRAINT "MediaClip_roadEventId_fkey" FOREIGN KEY ("roadEventId") REFERENCES "RoadEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
