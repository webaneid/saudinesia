-- DropForeignKey
ALTER TABLE "booking_tour_packages" DROP CONSTRAINT "booking_tour_packages_transportQuotaId_fkey";

-- DropForeignKey
ALTER TABLE "tour_packages" DROP CONSTRAINT "tour_packages_transportTripId_fkey";

-- AlterTable
ALTER TABLE "booking_tour_packages" ALTER COLUMN "transportQuotaId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "tour_packages" ALTER COLUMN "transportTripId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "tour_packages" ADD CONSTRAINT "tour_packages_transportTripId_fkey" FOREIGN KEY ("transportTripId") REFERENCES "transport_trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_tour_packages" ADD CONSTRAINT "booking_tour_packages_transportQuotaId_fkey" FOREIGN KEY ("transportQuotaId") REFERENCES "transport_quotas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

