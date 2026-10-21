-- CreateTable
CREATE TABLE "tour_package_hotels" (
    "id" TEXT NOT NULL,
    "tourPackageId" TEXT NOT NULL,
    "hotelRoomScheduleId" TEXT NOT NULL,
    "nights" INTEGER NOT NULL,
    "numRooms" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tour_package_hotels_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "tour_package_hotels" ADD CONSTRAINT "tour_package_hotels_tourPackageId_fkey" FOREIGN KEY ("tourPackageId") REFERENCES "tour_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_package_hotels" ADD CONSTRAINT "tour_package_hotels_hotelRoomScheduleId_fkey" FOREIGN KEY ("hotelRoomScheduleId") REFERENCES "hotel_room_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

