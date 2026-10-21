-- DropForeignKey
ALTER TABLE "hotel_room_schedules" DROP CONSTRAINT "hotel_room_schedules_hotelId_fkey";

-- AlterTable
ALTER TABLE "hotel_room_schedules" DROP COLUMN "hotelId",
DROP COLUMN "periodEnd",
DROP COLUMN "periodStart",
ADD COLUMN     "periodId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "hotel_price_periods" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotel_price_periods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hotel_room_schedules_periodId_roomTypeId_key" ON "hotel_room_schedules"("periodId", "roomTypeId");

-- AddForeignKey
ALTER TABLE "hotel_price_periods" ADD CONSTRAINT "hotel_price_periods_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "hotels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_room_schedules" ADD CONSTRAINT "hotel_room_schedules_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "hotel_price_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

