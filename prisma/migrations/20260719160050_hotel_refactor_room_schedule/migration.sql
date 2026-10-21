-- DropForeignKey
ALTER TABLE "booking_hotels" DROP CONSTRAINT "booking_hotels_hotelQuotaId_fkey";

-- DropForeignKey
ALTER TABLE "booking_hotels" DROP CONSTRAINT "booking_hotels_hotelRoomId_fkey";

-- DropForeignKey
ALTER TABLE "hotel_quotas" DROP CONSTRAINT "hotel_quotas_hotelRoomId_fkey";

-- DropForeignKey
ALTER TABLE "hotel_rooms" DROP CONSTRAINT "hotel_rooms_hotelId_fkey";

-- AlterTable
ALTER TABLE "booking_hotels" DROP COLUMN "hotelQuotaId",
DROP COLUMN "hotelRoomId",
ADD COLUMN     "hotelRoomScheduleId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "hotels" ADD COLUMN     "facilities" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "featuredImageKey" TEXT;

-- DropTable
DROP TABLE "hotel_quotas";

-- DropTable
DROP TABLE "hotel_rooms";

-- CreateTable
CREATE TABLE "room_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultCapacity" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_room_schedules" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "totalQuota" INTEGER NOT NULL DEFAULT 0,
    "pendingQuota" INTEGER NOT NULL DEFAULT 0,
    "bookedQuota" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotel_room_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "room_types_name_key" ON "room_types"("name");

-- AddForeignKey
ALTER TABLE "hotel_room_schedules" ADD CONSTRAINT "hotel_room_schedules_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "hotels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_room_schedules" ADD CONSTRAINT "hotel_room_schedules_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "room_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_hotels" ADD CONSTRAINT "booking_hotels_hotelRoomScheduleId_fkey" FOREIGN KEY ("hotelRoomScheduleId") REFERENCES "hotel_room_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

