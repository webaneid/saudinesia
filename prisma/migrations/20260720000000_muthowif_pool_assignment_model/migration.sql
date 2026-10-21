-- Muthowif upgrade (docs/arsitektur-muthowif.md §9): booking generik + assignment admin,
-- bukan lagi jamaah pilih nama saat booking. muthowifId jadi nullable (di-assign belakangan),
-- harga pindah dari per-orang ke satu layanan flat (MuthowifServicePrice), tambah pool
-- capacity terpisah dari kapasitas individual (MuthowifPoolAvailability).

-- DropForeignKey
ALTER TABLE "booking_muthowif" DROP CONSTRAINT "booking_muthowif_muthowifId_fkey";

-- AlterTable
ALTER TABLE "booking_muthowif" ADD COLUMN     "assignedAt" TIMESTAMP(3),
ALTER COLUMN "muthowifId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "muthowif" DROP COLUMN "priceHajj",
DROP COLUMN "priceRamadan",
DROP COLUMN "priceRegular";

-- CreateTable
CREATE TABLE "muthowif_service_price" (
    "id" TEXT NOT NULL,
    "priceRegular" DECIMAL(12,2) NOT NULL,
    "priceRamadan" DECIMAL(12,2) NOT NULL,
    "priceHajj" DECIMAL(12,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "muthowif_service_price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "muthowif_pool_availability" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "pendingCount" INTEGER NOT NULL DEFAULT 0,
    "bookedCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "muthowif_pool_availability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "muthowif_pool_availability_date_key" ON "muthowif_pool_availability"("date");

-- AddForeignKey
ALTER TABLE "booking_muthowif" ADD CONSTRAINT "booking_muthowif_muthowifId_fkey" FOREIGN KEY ("muthowifId") REFERENCES "muthowif"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed baris tunggal MuthowifServicePrice — nilai representatif dari rata-rata harga per-orang
-- lama (Ustaz Muhammad Fauzi, guide dengan harga median dari 3 seed sebelumnya), bukan angka bisnis final.
INSERT INTO "muthowif_service_price" ("id", "priceRegular", "priceRamadan", "priceHajj", "updatedAt")
VALUES ('8f82b406-1701-4129-a14f-c4811c000ab9', 300000, 520000, 750000, CURRENT_TIMESTAMP);
