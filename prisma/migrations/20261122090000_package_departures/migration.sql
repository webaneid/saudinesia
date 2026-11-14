-- K1 (docs/arsitektur-paket-umroh.md §8, evaluasi 2026-11-14): Paket Umroh dijual per keberangkatan.
-- • packages.durationDays / itinerary / exclusions: durasi (hari) dan isi halaman detail.
-- • package_departures: daftar keberangkatan per paket (tanggal, kursi, aktif); tanggal pulang turunan durasi, tidak disimpan.
-- • booking_packages.departureId: keberangkatan yang dipesan (NULL hanya untuk baris sebelum K1).
-- Murni aditif — tidak ada data lama yang diubah atau dihapus.

-- AlterTable
ALTER TABLE "booking_packages" ADD COLUMN     "departureId" TEXT;

-- AlterTable
ALTER TABLE "packages" ADD COLUMN     "durationDays" INTEGER,
ADD COLUMN     "exclusions" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "itinerary" JSONB NOT NULL DEFAULT '[]';

-- Durasi bila diisi: 1..60 hari; isi halaman detail selalu berupa array JSON.
ALTER TABLE "packages" ADD CONSTRAINT "packages_duration_days_range" CHECK ("durationDays" IS NULL OR "durationDays" BETWEEN 1 AND 60);
ALTER TABLE "packages" ADD CONSTRAINT "packages_itinerary_array" CHECK (jsonb_typeof("itinerary") = 'array');
ALTER TABLE "packages" ADD CONSTRAINT "packages_exclusions_array" CHECK (jsonb_typeof("exclusions") = 'array');

-- CreateTable
CREATE TABLE "package_departures" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "departureDate" DATE NOT NULL,
    "totalSeats" INTEGER NOT NULL,
    "pendingSeats" INTEGER NOT NULL DEFAULT 0,
    "bookedSeats" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok (timestamptz)
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "package_departures_pkey" PRIMARY KEY ("id"),
    -- Kursi tak pernah negatif dan yang ditahan + terjual tak melebihi total (lapis kedua di belakang lib/quota).
    CONSTRAINT "package_departures_seats_valid" CHECK ("totalSeats" >= 0 AND "pendingSeats" >= 0 AND "bookedSeats" >= 0 AND "pendingSeats" + "bookedSeats" <= "totalSeats")
);

-- CreateIndex
CREATE UNIQUE INDEX "package_departures_packageId_departureDate_key" ON "package_departures"("packageId", "departureDate");

-- CreateIndex
CREATE INDEX "booking_packages_departureId_idx" ON "booking_packages"("departureId");

-- AddForeignKey
ALTER TABLE "package_departures" ADD CONSTRAINT "package_departures_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_packages" ADD CONSTRAINT "booking_packages_departureId_fkey" FOREIGN KEY ("departureId") REFERENCES "package_departures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
