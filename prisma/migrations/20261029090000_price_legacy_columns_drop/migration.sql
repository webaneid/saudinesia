-- Fase 5 harga terpadu (docs/arsitektur-harga-terpadu.md §18): KONTRAKSI. Kolom harga lama dihapus — `price_points` adalah satu-satunya sumber harga.
-- Atomik (satu transaksi migrasi) dan FAIL-CLOSED: tak ada harga yang boleh hilang. Bila ada nilai lama yang BELUM punya titik harga, migrasi berhenti dengan pesan
-- yang menyebut tabelnya (jalankan hitung ulang harga — `repriceAll()` saat boot server — lalu ulangi).

-- 1. Pengaman: setiap harga lama > 0 harus sudah punya titik harga berharga > 0 (komposit/produk dasar: varian apa pun; katering: per musim).
DO $$
DECLARE
  bad TEXT := '';
  n INT;
BEGIN
  SELECT count(*) INTO n FROM flight_schedules x WHERE x."price" > 0 AND NOT EXISTS (SELECT 1 FROM price_points p WHERE p."ownerType" = 'flight' AND p."ownerId" = x."id" AND p."sellIdr" > 0);
  IF n > 0 THEN bad := bad || format('flight_schedules (%s) ', n); END IF;
  SELECT count(*) INTO n FROM hotel_room_schedules x WHERE x."price" > 0 AND NOT EXISTS (SELECT 1 FROM price_points p WHERE p."ownerType" = 'hotel' AND p."ownerId" = x."id" AND p."sellIdr" > 0);
  IF n > 0 THEN bad := bad || format('hotel_room_schedules (%s) ', n); END IF;
  SELECT count(*) INTO n FROM transport_pricing x WHERE x."price" > 0 AND NOT EXISTS (SELECT 1 FROM price_points p WHERE p."ownerType" = 'transport' AND p."ownerId" = x."id" AND p."sellIdr" > 0);
  IF n > 0 THEN bad := bad || format('transport_pricing (%s) ', n); END IF;
  SELECT count(*) INTO n FROM muthowif_service_price x WHERE x."price" > 0 AND NOT EXISTS (SELECT 1 FROM price_points p WHERE p."ownerType" = 'muthowif' AND p."ownerId" = x."id" AND p."sellIdr" > 0);
  IF n > 0 THEN bad := bad || format('muthowif_service_price (%s) ', n); END IF;
  SELECT count(*) INTO n FROM haji_products x WHERE x."price" > 0 AND NOT EXISTS (SELECT 1 FROM price_points p WHERE p."ownerType" = 'haji' AND p."ownerId" = x."id" AND p."sellIdr" > 0);
  IF n > 0 THEN bad := bad || format('haji_products (%s) ', n); END IF;
  SELECT count(*) INTO n FROM packages x WHERE x."price" > 0 AND NOT EXISTS (SELECT 1 FROM price_points p WHERE p."ownerType" = 'package' AND p."ownerId" = x."id" AND p."sellIdr" > 0);
  IF n > 0 THEN bad := bad || format('packages (%s) ', n); END IF;
  SELECT count(*) INTO n FROM tour_packages x WHERE x."price" > 0 AND NOT EXISTS (SELECT 1 FROM price_points p WHERE p."ownerType" = 'tour_package' AND p."ownerId" = x."id" AND p."sellIdr" > 0);
  IF n > 0 THEN bad := bad || format('tour_packages (%s) ', n); END IF;
  -- Visa: harga hanya lahir dari tier (varian) — `price` lama adalah "mulai dari" turunan tier dan backfill Fase 2 sengaja tak membuat titik untuk rentang ber-fee 0 atau
  -- untuk `price` tanpa tier (cache basi). Jadi yang diwajibkan punya titik hanya produk dengan SETIDAKNYA SATU tier ber-fee > 0 (durationFeeRules yang bukan array diabaikan).
  SELECT count(*) INTO n FROM visa_products x
  WHERE jsonb_typeof(x."durationFeeRules") = 'array'
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(x."durationFeeRules") r WHERE jsonb_typeof(r) = 'object' AND COALESCE((r->>'fee')::numeric, 0) > 0)
    AND NOT EXISTS (SELECT 1 FROM price_points p WHERE p."ownerType" = 'visa' AND p."ownerId" = x."id" AND p."sellIdr" > 0);
  IF n > 0 THEN bad := bad || format('visa_products (%s) ', n); END IF;
  SELECT count(*) INTO n FROM hotel_services x WHERE x."price" > 0 AND NOT EXISTS (SELECT 1 FROM price_points p WHERE p."ownerType" = 'hotel_service' AND p."ownerId" = x."id" AND p."sellIdr" > 0);
  IF n > 0 THEN bad := bad || format('hotel_services (%s) ', n); END IF;
  SELECT count(*) INTO n FROM catering_options x WHERE
       (x."pricePerPersonRegular" > 0 AND NOT EXISTS (SELECT 1 FROM price_points p WHERE p."ownerType" = 'catering' AND p."ownerId" = x."id" AND p."variantKey" = 'season:regular' AND p."sellIdr" > 0))
    OR (x."pricePerPersonRamadan" > 0 AND NOT EXISTS (SELECT 1 FROM price_points p WHERE p."ownerType" = 'catering' AND p."ownerId" = x."id" AND p."variantKey" = 'season:ramadan' AND p."sellIdr" > 0))
    OR (x."pricePerPersonHajj" > 0 AND NOT EXISTS (SELECT 1 FROM price_points p WHERE p."ownerType" = 'catering' AND p."ownerId" = x."id" AND p."variantKey" = 'season:hajj' AND p."sellIdr" > 0));
  IF n > 0 THEN bad := bad || format('catering_options (%s) ', n); END IF;

  IF bad <> '' THEN
    RAISE EXCEPTION 'Kontraksi harga dibatalkan: harga lama belum punya titik harga di %— buat titik harganya lebih dulu (jalankan repriceAll lewat skrip sekali jalan atau image web versi sebelumnya, atau atur harga manual), lalu ulangi migrasi', bad;
  END IF;
END $$;

-- 2. Riwayat kurs/vendor beku Visa (kolom lama VisaApplication) dipindah ke snapshot-nya (booking lama hasil backfill Fase 4 belum membawanya). Snapshot BEKU
--    (trigger menolak UPDATE) — dinonaktifkan HANYA untuk pemindahan ini, di dalam transaksi migrasi, lalu diaktifkan kembali.
ALTER TABLE "price_snapshots" DISABLE TRIGGER "price_snapshots_no_update";
UPDATE "price_snapshots" s
SET "fxRateIds" = COALESCE(va."exchangeRateIdsUsed", '[]'::jsonb), "vendorIds" = COALESCE(va."vendorIdsUsed", '[]'::jsonb)
FROM "visa_applications" va
WHERE s."itemType" = 'visa' AND s."itemId" = va."id"
  AND s."fxRateIds" = '[]'::jsonb AND s."vendorIds" = '[]'::jsonb
  AND (va."exchangeRateIdsUsed" IS NOT NULL OR va."vendorIdsUsed" IS NOT NULL);
ALTER TABLE "price_snapshots" ENABLE TRIGGER "price_snapshots_no_update";

-- 3. Kontraksi.
ALTER TABLE "flight_schedules" DROP COLUMN "price";
ALTER TABLE "hotel_room_schedules" DROP COLUMN "price";
ALTER TABLE "hotel_services" DROP COLUMN "price";
ALTER TABLE "transport_pricing" DROP COLUMN "price";
ALTER TABLE "muthowif_service_price" DROP COLUMN "price";
ALTER TABLE "haji_products" DROP COLUMN "price";
ALTER TABLE "packages" DROP COLUMN "price";
ALTER TABLE "tour_packages" DROP COLUMN "price";
ALTER TABLE "visa_products" DROP COLUMN "price", DROP COLUMN "durationFeeRules";
ALTER TABLE "catering_options" DROP COLUMN "pricePerPersonRegular", DROP COLUMN "pricePerPersonRamadan", DROP COLUMN "pricePerPersonHajj";
ALTER TABLE "visa_applications" DROP COLUMN "hppSnapshotRupiah", DROP COLUMN "sellPriceSnapshot", DROP COLUMN "exchangeRateIdsUsed", DROP COLUMN "vendorIdsUsed";
