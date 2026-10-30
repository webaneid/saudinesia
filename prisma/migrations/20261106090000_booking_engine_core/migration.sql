-- Inti engine booking (docs/arsitektur-booking-engine-v2.md §10.2, Fase 4).
-- • users.allowVisaWithoutBundle — pelonggaran aturan visa per pelanggan (D5)
-- • visa_products.requiredComponents: array string lama → array objek {type}; nilai tak dikenal → migrasi BERHENTI (fail-closed)
-- • packages: jumlah kamar hotel `included` → isi kamar (orang per kamar). Maknanya BERUBAH (per rombongan → per orang), jadi paket hotel
--   `included` yang sudah berisi jumlah kamar membuat migrasi BERHENTI — admin harus meninjau harganya, bukan dikonversi diam-diam.
-- • booking_packages — item Paket Umroh (harga per orang, kursi tiket yang ditahan)

-- 1. Pelanggan
ALTER TABLE "users" ADD COLUMN "allowVisaWithoutBundle" BOOLEAN NOT NULL DEFAULT false;

-- 2. Aturan visa
DO $$
DECLARE bad INT;
BEGIN
  SELECT count(*) INTO bad FROM "visa_products" v
  WHERE jsonb_typeof(v."requiredComponents") <> 'array'
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v."requiredComponents") e
       WHERE NOT (
         (jsonb_typeof(e) = 'string' AND e #>> '{}' IN ('flight', 'hotel', 'transport'))
         OR (jsonb_typeof(e) = 'object' AND e ->> 'type' IN ('flight', 'hotel', 'transport'))
       )
     );
  IF bad > 0 THEN
    RAISE EXCEPTION 'booking_engine_core: % produk visa memiliki requiredComponents tak dikenal — tinjau manual sebelum migrasi', bad;
  END IF;
END $$;

UPDATE "visa_products" v SET "requiredComponents" = (
  SELECT COALESCE(jsonb_agg(DISTINCT CASE WHEN jsonb_typeof(e) = 'string' THEN jsonb_build_object('type', e #>> '{}') ELSE e END), '[]'::jsonb)
  FROM jsonb_array_elements(v."requiredComponents") e
)
WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v."requiredComponents") e WHERE jsonb_typeof(e) = 'string');

-- 3. Paket: jumlah kamar → isi kamar
DO $$
DECLARE bad INT;
BEGIN
  SELECT count(*) INTO bad FROM "packages"
  WHERE ("hotelMakkahMode" = 'included' AND "includedHotelMakkahNumRooms" IS NOT NULL)
     OR ("hotelMadinahMode" = 'included' AND "includedHotelMadinahNumRooms" IS NOT NULL);
  IF bad > 0 THEN
    RAISE EXCEPTION 'booking_engine_core: % paket memakai hotel included dengan jumlah kamar — harga paket kini PER ORANG (isi kamar); tinjau paket itu dulu', bad;
  END IF;
END $$;

ALTER TABLE "packages" DROP COLUMN "includedHotelMakkahNumRooms", DROP COLUMN "includedHotelMadinahNumRooms",
  ADD COLUMN "includedHotelMakkahOccupancy" INTEGER, ADD COLUMN "includedHotelMadinahOccupancy" INTEGER;
ALTER TABLE "packages" ADD CONSTRAINT "packages_hotel_occupancy" CHECK (
  ("includedHotelMakkahOccupancy" IS NULL OR "includedHotelMakkahOccupancy" BETWEEN 1 AND 20)
  AND ("includedHotelMadinahOccupancy" IS NULL OR "includedHotelMadinahOccupancy" BETWEEN 1 AND 20)
);

-- 4. Item Paket Umroh
CREATE TABLE "booking_packages" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "departureDate" DATE NOT NULL,
    "returnDate" DATE NOT NULL,
    "numPeople" INTEGER NOT NULL,
    "flightScheduleId" TEXT,
    "choices" JSONB NOT NULL DEFAULT '{}',
    "totalPrice" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "booking_packages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "booking_packages_shape" CHECK ("numPeople" >= 1 AND "returnDate" >= "departureDate" AND "totalPrice" >= 0 AND jsonb_typeof("choices") = 'object')
);
CREATE INDEX "booking_packages_bookingId_idx" ON "booking_packages"("bookingId");
CREATE INDEX "booking_packages_packageId_idx" ON "booking_packages"("packageId");
ALTER TABLE "booking_packages" ADD CONSTRAINT "booking_packages_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_packages" ADD CONSTRAINT "booking_packages_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_packages" ADD CONSTRAINT "booking_packages_flightScheduleId_fkey" FOREIGN KEY ("flightScheduleId") REFERENCES "flight_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
