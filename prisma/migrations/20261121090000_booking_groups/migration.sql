-- Rombongan dalam satu booking (docs/arsitektur-booking-engine-v2.md §10.8, Fase 11d-1). Aditif: booking lama tanpa baris rombongan = satu rombongan.
-- FK komposit (groupId, bookingId) → booking_groups(id, bookingId): item/jamaah hanya dapat menunjuk rombongan booking yang SAMA.

-- AlterTable
ALTER TABLE "booking_catering" ADD COLUMN     "groupId" TEXT;

-- AlterTable
ALTER TABLE "booking_flights" ADD COLUMN     "groupId" TEXT;

-- AlterTable
ALTER TABLE "booking_haji" ADD COLUMN     "groupId" TEXT;

-- AlterTable
ALTER TABLE "booking_hotels" ADD COLUMN     "groupId" TEXT;

-- AlterTable
ALTER TABLE "booking_muthowif" ADD COLUMN     "groupId" TEXT;

-- AlterTable
ALTER TABLE "booking_packages" ADD COLUMN     "groupId" TEXT;

-- AlterTable
ALTER TABLE "booking_pilgrims" ADD COLUMN     "groupId" TEXT;

-- AlterTable
ALTER TABLE "booking_tour_packages" ADD COLUMN     "groupId" TEXT;

-- AlterTable
ALTER TABLE "booking_transports" ADD COLUMN     "groupId" TEXT;

-- CreateTable
CREATE TABLE "booking_groups" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT,
    "plannedTravelDate" DATE,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok (timestamptz)

    CONSTRAINT "booking_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "booking_groups_bookingId_position_key" ON "booking_groups"("bookingId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "booking_groups_id_bookingId_key" ON "booking_groups"("id", "bookingId");

-- CreateIndex
CREATE INDEX "booking_catering_groupId_idx" ON "booking_catering"("groupId");

-- CreateIndex
CREATE INDEX "booking_flights_groupId_idx" ON "booking_flights"("groupId");

-- CreateIndex
CREATE INDEX "booking_haji_groupId_idx" ON "booking_haji"("groupId");

-- CreateIndex
CREATE INDEX "booking_hotels_groupId_idx" ON "booking_hotels"("groupId");

-- CreateIndex
CREATE INDEX "booking_muthowif_groupId_idx" ON "booking_muthowif"("groupId");

-- CreateIndex
CREATE INDEX "booking_packages_groupId_idx" ON "booking_packages"("groupId");

-- CreateIndex
CREATE INDEX "booking_pilgrims_groupId_idx" ON "booking_pilgrims"("groupId");

-- CreateIndex
CREATE INDEX "booking_tour_packages_groupId_idx" ON "booking_tour_packages"("groupId");

-- CreateIndex
CREATE INDEX "booking_transports_groupId_idx" ON "booking_transports"("groupId");

-- AddForeignKey
ALTER TABLE "booking_flights" ADD CONSTRAINT "booking_flights_groupId_bookingId_fkey" FOREIGN KEY ("groupId", "bookingId") REFERENCES "booking_groups"("id", "bookingId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_groups" ADD CONSTRAINT "booking_groups_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_pilgrims" ADD CONSTRAINT "booking_pilgrims_groupId_bookingId_fkey" FOREIGN KEY ("groupId", "bookingId") REFERENCES "booking_groups"("id", "bookingId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_hotels" ADD CONSTRAINT "booking_hotels_groupId_bookingId_fkey" FOREIGN KEY ("groupId", "bookingId") REFERENCES "booking_groups"("id", "bookingId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_transports" ADD CONSTRAINT "booking_transports_groupId_bookingId_fkey" FOREIGN KEY ("groupId", "bookingId") REFERENCES "booking_groups"("id", "bookingId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_muthowif" ADD CONSTRAINT "booking_muthowif_groupId_bookingId_fkey" FOREIGN KEY ("groupId", "bookingId") REFERENCES "booking_groups"("id", "bookingId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_catering" ADD CONSTRAINT "booking_catering_groupId_bookingId_fkey" FOREIGN KEY ("groupId", "bookingId") REFERENCES "booking_groups"("id", "bookingId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_tour_packages" ADD CONSTRAINT "booking_tour_packages_groupId_bookingId_fkey" FOREIGN KEY ("groupId", "bookingId") REFERENCES "booking_groups"("id", "bookingId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_haji" ADD CONSTRAINT "booking_haji_groupId_bookingId_fkey" FOREIGN KEY ("groupId", "bookingId") REFERENCES "booking_groups"("id", "bookingId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_packages" ADD CONSTRAINT "booking_packages_groupId_bookingId_fkey" FOREIGN KEY ("groupId", "bookingId") REFERENCES "booking_groups"("id", "bookingId") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Bentuk rombongan dijaga DB (Prisma tak memodelkan CHECK): posisi mulai 1; nama bebas pemesan 1–60 karakter, tanpa karakter kontrol.
ALTER TABLE "booking_groups" ADD CONSTRAINT "booking_groups_position_check" CHECK ("position" >= 1);
ALTER TABLE "booking_groups" ADD CONSTRAINT "booking_groups_label_check" CHECK ("label" IS NULL OR (char_length("label") BETWEEN 1 AND 60 AND "label" !~ '[[:cntrl:]]'));
