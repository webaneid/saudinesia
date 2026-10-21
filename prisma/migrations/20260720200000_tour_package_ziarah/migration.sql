-- Paket Ziarah terintegrasi Transport (docs/arsitektur-ziarah.md §8): HeritageTour/BookingTour
-- diganti total oleh TourPackage yang mereferensikan TransportTrip/TransportPricing/TransportQuota
-- yang sudah ada (bukan sistem kendaraan+kuota terpisah). Aman — booking_tours = 0 baris
-- (belum ada booking nyata), heritage_tours cuma seed data (4 baris).

-- DropForeignKey
ALTER TABLE "booking_tours" DROP CONSTRAINT "booking_tours_heritageTourId_fkey";

-- DropTable
DROP TABLE "booking_tours";

-- DropTable
DROP TABLE "heritage_tours";

-- CreateTable
CREATE TABLE "tourism_sites" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "description" TEXT,
    "photoKey" TEXT,
    "gmapsUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tourism_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tour_packages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "transportTripId" TEXT NOT NULL,
    "price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tour_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tour_package_sites" (
    "id" TEXT NOT NULL,
    "tourPackageId" TEXT NOT NULL,
    "tourismSiteId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tour_package_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_tour_packages" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "tourPackageId" TEXT NOT NULL,
    "transportQuotaId" TEXT NOT NULL,
    "tourDate" DATE NOT NULL,
    "numPeople" INTEGER NOT NULL,
    "totalPrice" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "booking_tour_packages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tour_package_sites_tourPackageId_tourismSiteId_key" ON "tour_package_sites"("tourPackageId", "tourismSiteId");

-- AddForeignKey
ALTER TABLE "tour_packages" ADD CONSTRAINT "tour_packages_transportTripId_fkey" FOREIGN KEY ("transportTripId") REFERENCES "transport_trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_package_sites" ADD CONSTRAINT "tour_package_sites_tourPackageId_fkey" FOREIGN KEY ("tourPackageId") REFERENCES "tour_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_package_sites" ADD CONSTRAINT "tour_package_sites_tourismSiteId_fkey" FOREIGN KEY ("tourismSiteId") REFERENCES "tourism_sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_tour_packages" ADD CONSTRAINT "booking_tour_packages_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_tour_packages" ADD CONSTRAINT "booking_tour_packages_tourPackageId_fkey" FOREIGN KEY ("tourPackageId") REFERENCES "tour_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_tour_packages" ADD CONSTRAINT "booking_tour_packages_transportQuotaId_fkey" FOREIGN KEY ("transportQuotaId") REFERENCES "transport_quotas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
