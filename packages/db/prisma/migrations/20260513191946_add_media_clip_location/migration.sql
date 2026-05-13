-- AlterTable
ALTER TABLE "MediaClip" ADD COLUMN     "accuracyMeters" DOUBLE PRECISION,
ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION,
ADD COLUMN     "speedMph" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "MediaClip_lat_lng_idx" ON "MediaClip"("lat", "lng");
