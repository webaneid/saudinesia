-- Fase 4 harga terpadu (docs/arsitektur-harga-terpadu.md §17). Atomik (satu transaksi migrasi); tidak menyentuh kolom harga lama.

-- 1. Tabel snapshot harga (dibekukan saat dipesan). Aturan bentuk dijaga DB, bukan hanya kode.
CREATE TABLE "price_snapshots" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lineKey" TEXT NOT NULL DEFAULT 'main',
    "ownerType" TEXT,
    "ownerId" TEXT,
    "variantKey" TEXT NOT NULL DEFAULT '',
    "itemLabel" TEXT NOT NULL,
    "itemDetail" TEXT NOT NULL DEFAULT '',
    "itemQty" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "qty" DECIMAL(12,2) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitCostIdr" DECIMAL(14,2),
    "unitSellIdr" DECIMAL(14,2) NOT NULL,
    "totalCostIdr" DECIMAL(14,2),
    "totalSellIdr" DECIMAL(14,2) NOT NULL,
    "mode" TEXT NOT NULL,
    "fxRateIds" JSONB NOT NULL DEFAULT '[]',
    "vendorIds" JSONB NOT NULL DEFAULT '[]',
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "price_snapshots_itemType_itemId_lineKey_key" ON "price_snapshots"("itemType", "itemId", "lineKey");
CREATE INDEX "price_snapshots_bookingId_idx" ON "price_snapshots"("bookingId");
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "price_snapshots"
  ADD CONSTRAINT "price_snapshots_mode_valid"    CHECK ("mode" IN ('auto', 'manual')),
  ADD CONSTRAINT "price_snapshots_qty_positive"  CHECK ("qty" > 0 AND "itemQty" > 0),
  -- jual/modal tidak negatif; hanya baris penyesuaian (diskon / selisih) boleh bernilai negatif
  ADD CONSTRAINT "price_snapshots_non_negative"  CHECK ("lineKey" LIKE 'penyesuaian%' OR ("unitSellIdr" >= 0 AND ("unitCostIdr" IS NULL OR "unitCostIdr" >= 0))),
  -- total = satuan × jumlah (dibulatkan sen); modal: kedua kolomnya terisi atau kosong bersama (IS NOT NULL eksplisit: CHECK yang bernilai NULL lolos)
  ADD CONSTRAINT "price_snapshots_total_sell"    CHECK ("totalSellIdr" = ROUND("unitSellIdr" * "qty", 2)),
  ADD CONSTRAINT "price_snapshots_total_cost"    CHECK (("unitCostIdr" IS NULL AND "totalCostIdr" IS NULL) OR ("unitCostIdr" IS NOT NULL AND "totalCostIdr" IS NOT NULL AND "totalCostIdr" = ROUND("unitCostIdr" * "qty", 2)));

-- 2. Beku sungguhan: UPDATE ditolak (koreksi = baris penyesuaian baru). Hapus tetap diizinkan agar hapus booking lewat cascade jalan.
CREATE FUNCTION "price_snapshots_frozen"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'price_snapshots bersifat beku: koreksi harga ditulis sebagai baris penyesuaian baru' USING ERRCODE = 'check_violation';
END;
$$;
CREATE TRIGGER "price_snapshots_no_update" BEFORE UPDATE ON "price_snapshots" FOR EACH ROW EXECUTE FUNCTION "price_snapshots_frozen"();

-- 3. Booking LAMA (sebelum snapshot): satu baris `main` per item, HANYA jual (modal tak pernah dicatat — kecuali Visa yang punya HPP beku sendiri).
--    Judul/rincian disusun dari data yang ada. Tujuannya satu: invarian I4 (total = Σ snapshot) berlaku untuk SEMUA booking.
INSERT INTO "price_snapshots" ("id","bookingId","itemType","itemId","itemLabel","itemDetail","itemQty","description","qty","unit","unitSellIdr","totalSellIdr","mode","ownerType","ownerId")
SELECT gen_random_uuid()::text, bh."bookingId", 'hotel', bh."id",
       h."name" || ' — ' || rt."name",
       to_char(bh."checkIn",'DD-MM-YYYY') || ' – ' || to_char(bh."checkOut",'DD-MM-YYYY') || ' · ' || bh."nights" || ' malam · ' || bh."numRooms" || ' kamar',
       GREATEST(bh."numRooms",1), h."name" || ' — ' || rt."name", 1, 'item', bh."totalPrice", bh."totalPrice", 'auto', 'hotel', bh."hotelRoomScheduleId"
FROM "booking_hotels" bh
JOIN "hotel_room_schedules" hrs ON hrs."id" = bh."hotelRoomScheduleId"
JOIN "hotel_price_periods" pp ON pp."id" = hrs."periodId"
JOIN "hotels" h ON h."id" = pp."hotelId"
JOIN "room_types" rt ON rt."id" = hrs."roomTypeId";

INSERT INTO "price_snapshots" ("id","bookingId","itemType","itemId","itemLabel","itemDetail","itemQty","description","qty","unit","unitSellIdr","totalSellIdr","mode","ownerType","ownerId")
SELECT gen_random_uuid()::text, bt."bookingId", 'transport', bt."id",
       tr."name" || ' (' || v."name" || ')',
       to_char(bt."travelDate",'DD-MM-YYYY') || ' · ' || bt."numPassengers" || ' penumpang',
       GREATEST(bt."numPassengers",1), tr."name" || ' (' || v."name" || ')', 1, 'item', bt."totalPrice", bt."totalPrice", 'auto', 'transport', tq."pricingId"
FROM "booking_transports" bt
JOIN "transport_quotas" tq ON tq."id" = bt."transportQuotaId"
JOIN "transport_pricing" tp ON tp."id" = tq."pricingId"
JOIN "transport_trips" tr ON tr."id" = tp."tripId"
JOIN "transport_vehicles" v ON v."id" = tp."vehicleId";

INSERT INTO "price_snapshots" ("id","bookingId","itemType","itemId","itemLabel","itemDetail","itemQty","description","qty","unit","unitSellIdr","totalSellIdr","mode")
SELECT gen_random_uuid()::text, bm."bookingId", 'muthowif', bm."id", 'Layanan Muthowif',
       to_char(bm."startDate",'DD-MM-YYYY') || ' – ' || to_char(bm."endDate",'DD-MM-YYYY') || ' · ' || bm."numDays" || ' hari · ' || bm."numPeople" || ' orang',
       GREATEST(bm."numPeople",1), 'Layanan Muthowif', 1, 'item', bm."totalPrice", bm."totalPrice", 'auto'
FROM "booking_muthowif" bm;

INSERT INTO "price_snapshots" ("id","bookingId","itemType","itemId","itemLabel","itemDetail","itemQty","description","qty","unit","unitSellIdr","totalSellIdr","mode")
SELECT gen_random_uuid()::text, bc."bookingId", 'catering', bc."id", co."name",
       to_char(bc."startDate",'DD-MM-YYYY') || ' – ' || to_char(bc."endDate",'DD-MM-YYYY') || ' · ' || bc."numDays" || ' hari · ' || bc."numPeople" || ' orang',
       GREATEST(bc."numPeople",1), co."name", 1, 'item', bc."totalPrice", bc."totalPrice", 'auto'
FROM "booking_catering" bc
JOIN "catering_options" co ON co."id" = bc."cateringOptionId";

INSERT INTO "price_snapshots" ("id","bookingId","itemType","itemId","itemLabel","itemDetail","itemQty","description","qty","unit","unitSellIdr","totalSellIdr","mode","ownerType","ownerId")
SELECT gen_random_uuid()::text, btp."bookingId", 'tourPackage', btp."id", tp."name",
       to_char(btp."tourDate",'DD-MM-YYYY') || ' · ' || btp."numPeople" || ' orang',
       GREATEST(btp."numPeople",1), tp."name", 1, 'item', btp."totalPrice", btp."totalPrice", 'auto', 'tour_package', btp."tourPackageId"
FROM "booking_tour_packages" btp
JOIN "tour_packages" tp ON tp."id" = btp."tourPackageId";

INSERT INTO "price_snapshots" ("id","bookingId","itemType","itemId","itemLabel","itemDetail","itemQty","description","qty","unit","unitSellIdr","totalSellIdr","mode","ownerType","ownerId")
SELECT gen_random_uuid()::text, bj."bookingId", 'haji', bj."id", hp."name", bj."numPersons" || ' orang',
       GREATEST(bj."numPersons",1), hp."name", 1, 'item', bj."totalPrice", bj."totalPrice", 'auto', 'haji', bj."hajiProductId"
FROM "booking_haji" bj
JOIN "haji_products" hp ON hp."id" = bj."hajiProductId";

-- Visa: HPP beku milik VisaApplication ikut dibawa (hanya bila > 0).
INSERT INTO "price_snapshots" ("id","bookingId","itemType","itemId","itemLabel","itemDetail","itemQty","description","qty","unit","unitCostIdr","unitSellIdr","totalCostIdr","totalSellIdr","mode","ownerType","ownerId")
SELECT gen_random_uuid()::text, bp."bookingId", 'visa', va."id",
       CASE WHEN COALESCE(vp."name", va."visaType") ILIKE '%visa%' THEN COALESCE(vp."name", va."visaType") ELSE 'Visa ' || COALESCE(vp."name", va."visaType") END,
       COALESCE(va."selectedDurationDays"::text || ' hari', ''),
       1,
       CASE WHEN COALESCE(vp."name", va."visaType") ILIKE '%visa%' THEN COALESCE(vp."name", va."visaType") ELSE 'Visa ' || COALESCE(vp."name", va."visaType") END,
       1, 'person',
       CASE WHEN va."hppSnapshotRupiah" > 0 THEN va."hppSnapshotRupiah" END,
       va."sellPriceSnapshot",
       CASE WHEN va."hppSnapshotRupiah" > 0 THEN va."hppSnapshotRupiah" END,
       va."sellPriceSnapshot", 'auto', 'visa', va."visaProductId"
FROM "visa_applications" va
JOIN "booking_pilgrims" bp ON bp."id" = va."bookingPilgrimId"
LEFT JOIN "visa_products" vp ON vp."id" = va."visaProductId"
WHERE va."sellPriceSnapshot" IS NOT NULL;

-- Selisih antara total lama dan Σ item (booking era total-dari-klien, fixture, dst.) ditutup eksplisit sebagai baris penyesuaian tingkat-booking.
INSERT INTO "price_snapshots" ("id","bookingId","itemType","itemId","lineKey","itemLabel","itemDetail","itemQty","description","qty","unit","unitSellIdr","totalSellIdr","mode")
SELECT gen_random_uuid()::text, b."id", 'booking', b."id", 'penyesuaian', 'Penyesuaian data lama', 'Selisih terhadap jumlah item (booking sebelum snapshot harga)', 1,
       'Penyesuaian data lama', 1, 'item', b."totalAmount" - COALESCE(s."sum", 0), b."totalAmount" - COALESCE(s."sum", 0), 'auto'
FROM "bookings" b
LEFT JOIN (SELECT "bookingId", SUM("totalSellIdr") AS "sum" FROM "price_snapshots" GROUP BY "bookingId") s ON s."bookingId" = b."id"
WHERE b."totalAmount" <> COALESCE(s."sum", 0);
