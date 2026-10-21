-- Transport upgrade (docs/arsitektur-transportasi.md §9): origin/destination wajib,
-- harga musiman + charter/per-kursi dihapus jadi satu harga flat per rute×kendaraan,
-- isCharter dihapus dari BookingTransport (tabel kosong, tidak ada booking nyata — aman).

-- transport_trips: originHint/destinationHint (opsional) -> origin/destination (wajib)
ALTER TABLE "transport_trips" ADD COLUMN "origin" TEXT;
ALTER TABLE "transport_trips" ADD COLUMN "destination" TEXT;

UPDATE "transport_trips" SET
  "origin" = COALESCE("originHint", 'Hotel'),
  "destination" = COALESCE("destinationHint", 'Lokasi Ziarah')
WHERE "origin" IS NULL OR "destination" IS NULL;

ALTER TABLE "transport_trips" ALTER COLUMN "origin" SET NOT NULL;
ALTER TABLE "transport_trips" ALTER COLUMN "destination" SET NOT NULL;
ALTER TABLE "transport_trips" DROP COLUMN "originHint";
ALTER TABLE "transport_trips" DROP COLUMN "destinationHint";

-- transport_pricing: 6 kolom musiman + perSeatEnabled -> 1 kolom price flat (cache computeSellPrice())
ALTER TABLE "transport_pricing" ADD COLUMN "price" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "transport_pricing" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "transport_pricing" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill dari charterRegular lama supaya katalog tidak kosong selama transisi ke HPP
UPDATE "transport_pricing" SET "price" = COALESCE("charterRegular", 0);

ALTER TABLE "transport_pricing" DROP COLUMN "charterRegular";
ALTER TABLE "transport_pricing" DROP COLUMN "charterRamadan";
ALTER TABLE "transport_pricing" DROP COLUMN "charterHajj";
ALTER TABLE "transport_pricing" DROP COLUMN "perSeatEnabled";
ALTER TABLE "transport_pricing" DROP COLUMN "perSeatRegular";
ALTER TABLE "transport_pricing" DROP COLUMN "perSeatRamadan";
ALTER TABLE "transport_pricing" DROP COLUMN "perSeatHajj";

-- booking_transports: isCharter tidak bermakna lagi (satu-satunya mode harga sekarang flat)
ALTER TABLE "booking_transports" DROP COLUMN "isCharter";
