-- CreateEnum
CREATE TYPE "price_variable_mode" AS ENUM ('included', 'user_choice', 'none');

-- AlterTable
ALTER TABLE "booking_tour_packages" ADD COLUMN     "chosenHotelNumRooms" INTEGER,
ADD COLUMN     "chosenHotelRoomScheduleId" TEXT;

-- AlterTable
ALTER TABLE "tour_packages" ADD COLUMN     "hotelMode" "price_variable_mode" NOT NULL DEFAULT 'none',
ADD COLUMN     "includedTransportPrice" DECIMAL(14,2),
ADD COLUMN     "includedTransportPricingId" TEXT,
ADD COLUMN     "transportMode" "price_variable_mode" NOT NULL DEFAULT 'none';

-- CreateTable
CREATE TABLE "tour_package_hotel_options" (
    "id" TEXT NOT NULL,
    "tourPackageId" TEXT NOT NULL,
    "hotelRoomScheduleId" TEXT NOT NULL,
    "nights" INTEGER NOT NULL,

    CONSTRAINT "tour_package_hotel_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tour_package_hotel_options_tourPackageId_hotelRoomScheduleI_key" ON "tour_package_hotel_options"("tourPackageId", "hotelRoomScheduleId");

-- AddForeignKey
ALTER TABLE "tour_packages" ADD CONSTRAINT "tour_packages_includedTransportPricingId_fkey" FOREIGN KEY ("includedTransportPricingId") REFERENCES "transport_pricing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_package_hotel_options" ADD CONSTRAINT "tour_package_hotel_options_tourPackageId_fkey" FOREIGN KEY ("tourPackageId") REFERENCES "tour_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_package_hotel_options" ADD CONSTRAINT "tour_package_hotel_options_hotelRoomScheduleId_fkey" FOREIGN KEY ("hotelRoomScheduleId") REFERENCES "hotel_room_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_tour_packages" ADD CONSTRAINT "booking_tour_packages_chosenHotelRoomScheduleId_fkey" FOREIGN KEY ("chosenHotelRoomScheduleId") REFERENCES "hotel_room_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

