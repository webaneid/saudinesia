-- DropForeignKey
ALTER TABLE "package_items" DROP CONSTRAINT "package_items_packageId_fkey";

-- AlterTable
ALTER TABLE "packages" ADD COLUMN     "cateringMode" "price_variable_mode" NOT NULL DEFAULT 'none',
ADD COLUMN     "flightMode" "price_variable_mode" NOT NULL DEFAULT 'none',
ADD COLUMN     "flightRouteId" TEXT,
ADD COLUMN     "hotelMadinahMode" "price_variable_mode" NOT NULL DEFAULT 'none',
ADD COLUMN     "hotelMakkahMode" "price_variable_mode" NOT NULL DEFAULT 'none',
ADD COLUMN     "includedCateringNumDays" INTEGER,
ADD COLUMN     "includedCateringNumPeople" INTEGER,
ADD COLUMN     "includedCateringOptionId" TEXT,
ADD COLUMN     "includedCateringPrice" DECIMAL(14,2),
ADD COLUMN     "includedFlightPrice" DECIMAL(14,2),
ADD COLUMN     "includedFlightScheduleId" TEXT,
ADD COLUMN     "includedHotelMadinahNights" INTEGER,
ADD COLUMN     "includedHotelMadinahNumRooms" INTEGER,
ADD COLUMN     "includedHotelMadinahPrice" DECIMAL(14,2),
ADD COLUMN     "includedHotelMadinahScheduleId" TEXT,
ADD COLUMN     "includedHotelMakkahNights" INTEGER,
ADD COLUMN     "includedHotelMakkahNumRooms" INTEGER,
ADD COLUMN     "includedHotelMakkahPrice" DECIMAL(14,2),
ADD COLUMN     "includedHotelMakkahScheduleId" TEXT,
ADD COLUMN     "includedMuthowifPrice" DECIMAL(14,2),
ADD COLUMN     "includedTransportPrice" DECIMAL(14,2),
ADD COLUMN     "includedTransportPricingId" TEXT,
ADD COLUMN     "includedVisaPrice" DECIMAL(14,2),
ADD COLUMN     "includedVisaProductId" TEXT,
ADD COLUMN     "muthowifMode" "price_variable_mode" NOT NULL DEFAULT 'none',
ADD COLUMN     "transportMode" "price_variable_mode" NOT NULL DEFAULT 'none',
ADD COLUMN     "transportTripId" TEXT,
ADD COLUMN     "visaMode" "price_variable_mode" NOT NULL DEFAULT 'none';

-- DropTable
DROP TABLE "package_items";

-- CreateTable
CREATE TABLE "package_hotel_options" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "hotelRoomScheduleId" TEXT NOT NULL,
    "nights" INTEGER NOT NULL,

    CONSTRAINT "package_hotel_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_visa_options" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "visaProductId" TEXT NOT NULL,

    CONSTRAINT "package_visa_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_catering_options" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "cateringOptionId" TEXT NOT NULL,
    "numPeople" INTEGER NOT NULL,
    "numDays" INTEGER NOT NULL,

    CONSTRAINT "package_catering_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "package_hotel_options_packageId_slot_hotelRoomScheduleId_key" ON "package_hotel_options"("packageId", "slot", "hotelRoomScheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "package_visa_options_packageId_visaProductId_key" ON "package_visa_options"("packageId", "visaProductId");

-- CreateIndex
CREATE UNIQUE INDEX "package_catering_options_packageId_cateringOptionId_key" ON "package_catering_options"("packageId", "cateringOptionId");

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_transportTripId_fkey" FOREIGN KEY ("transportTripId") REFERENCES "transport_trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_includedTransportPricingId_fkey" FOREIGN KEY ("includedTransportPricingId") REFERENCES "transport_pricing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_includedVisaProductId_fkey" FOREIGN KEY ("includedVisaProductId") REFERENCES "visa_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_flightRouteId_fkey" FOREIGN KEY ("flightRouteId") REFERENCES "flight_routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_includedFlightScheduleId_fkey" FOREIGN KEY ("includedFlightScheduleId") REFERENCES "flight_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_includedCateringOptionId_fkey" FOREIGN KEY ("includedCateringOptionId") REFERENCES "catering_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_includedHotelMakkahScheduleId_fkey" FOREIGN KEY ("includedHotelMakkahScheduleId") REFERENCES "hotel_room_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_includedHotelMadinahScheduleId_fkey" FOREIGN KEY ("includedHotelMadinahScheduleId") REFERENCES "hotel_room_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_hotel_options" ADD CONSTRAINT "package_hotel_options_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_hotel_options" ADD CONSTRAINT "package_hotel_options_hotelRoomScheduleId_fkey" FOREIGN KEY ("hotelRoomScheduleId") REFERENCES "hotel_room_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_visa_options" ADD CONSTRAINT "package_visa_options_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_visa_options" ADD CONSTRAINT "package_visa_options_visaProductId_fkey" FOREIGN KEY ("visaProductId") REFERENCES "visa_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_catering_options" ADD CONSTRAINT "package_catering_options_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_catering_options" ADD CONSTRAINT "package_catering_options_cateringOptionId_fkey" FOREIGN KEY ("cateringOptionId") REFERENCES "catering_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

