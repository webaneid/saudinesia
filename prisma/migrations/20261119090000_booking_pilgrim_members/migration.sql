-- Visa V4a (docs/rencana-visa-produk.md §3.3): jamaah booking ditautkan ke Paket Umroh / Haji tempat ia menjadi anggota.
-- • booking_pilgrims.bookingPackageId → booking_packages, bookingHajiId → booking_haji (item dihapus → tautan lepas)
-- • Isi untuk booking lama = aturan yang sama dengan lib/booking/members.ts: paket bervisa dulu (pemegang visa paket itu, lalu jamaah tanpa visa,
--   lalu sisanya), kemudian paket tanpa visa (jamaah tanpa visa dulu); haji urut. Urutan jamaah = id (sama dengan "Jamaah ke-N" di revisi).
-- • Booking AKTIF yang anggotanya tak bisa diisi penuh (jamaah kurang dari jumlah orang paket/haji) → migrasi BERHENTI (tinjau manual).

ALTER TABLE "booking_pilgrims" ADD COLUMN "bookingHajiId" TEXT,
ADD COLUMN "bookingPackageId" TEXT;

CREATE INDEX "booking_pilgrims_bookingPackageId_idx" ON "booking_pilgrims"("bookingPackageId");
CREATE INDEX "booking_pilgrims_bookingHajiId_idx" ON "booking_pilgrims"("bookingHajiId");

ALTER TABLE "booking_pilgrims" ADD CONSTRAINT "booking_pilgrims_bookingPackageId_fkey" FOREIGN KEY ("bookingPackageId") REFERENCES "booking_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "booking_pilgrims" ADD CONSTRAINT "booking_pilgrims_bookingHajiId_fkey" FOREIGN KEY ("bookingHajiId") REFERENCES "booking_haji"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $$
DECLARE
  r RECORD;
  bad INT;
BEGIN
  -- Paket: baris bervisa dulu, lalu tanpa visa; dalam tiap kelompok urut id.
  FOR r IN
    SELECT bp."id", bp."bookingId", bp."numPeople",
           CASE WHEN p."visaMode" = 'included' THEN p."includedVisaProductId" ELSE bp."choices" ->> 'visaProductId' END AS visa
    FROM "booking_packages" bp JOIN "packages" p ON p."id" = bp."packageId"
    ORDER BY (CASE WHEN p."visaMode" = 'included' THEN p."includedVisaProductId" ELSE bp."choices" ->> 'visaProductId' END) IS NULL, bp."id"
  LOOP
    UPDATE "booking_pilgrims" SET "bookingPackageId" = r."id"
    WHERE "id" IN (
      SELECT g."id" FROM "booking_pilgrims" g
      LEFT JOIN "visa_applications" va ON va."bookingPilgrimId" = g."id"
      LEFT JOIN LATERAL (
        SELECT EXISTS (SELECT 1 FROM "price_snapshots" s WHERE s."itemType" = 'visa' AND s."itemId" = va."id" AND s."voidedAt" IS NULL) AS own
      ) o ON true
      WHERE g."bookingId" = r."bookingId" AND g."bookingPackageId" IS NULL
      ORDER BY
        CASE
          WHEN r.visa IS NOT NULL AND va."id" IS NOT NULL AND NOT o.own AND va."visaProductId" = r.visa THEN 0 -- pemegang visa paket ini
          WHEN va."id" IS NULL THEN 1                                                                       -- tanpa visa
          WHEN r.visa IS NULL AND o.own THEN 2                                                              -- paket tanpa visa: ber-visa sendiri
          ELSE 3
        END, g."id"
      LIMIT r."numPeople"
    );
  END LOOP;

  FOR r IN SELECT "id", "bookingId", "numPersons" FROM "booking_haji" ORDER BY "id" LOOP
    UPDATE "booking_pilgrims" SET "bookingHajiId" = r."id"
    WHERE "id" IN (
      SELECT "id" FROM "booking_pilgrims" WHERE "bookingId" = r."bookingId" AND "bookingHajiId" IS NULL ORDER BY "id" LIMIT r."numPersons"
    );
  END LOOP;

  SELECT count(*) INTO bad FROM (
    SELECT bp."id" FROM "booking_packages" bp JOIN "bookings" b ON b."id" = bp."bookingId"
    WHERE b."status" = 'active' AND bp."numPeople" <> (SELECT count(*) FROM "booking_pilgrims" g WHERE g."bookingPackageId" = bp."id")
    UNION ALL
    SELECT bh."id" FROM "booking_haji" bh JOIN "bookings" b ON b."id" = bh."bookingId"
    WHERE b."status" = 'active' AND bh."numPersons" <> (SELECT count(*) FROM "booking_pilgrims" g WHERE g."bookingHajiId" = bh."id")
  ) x;
  IF bad > 0 THEN
    RAISE EXCEPTION 'booking_pilgrim_members: % item paket/haji pada booking aktif berjamaah kurang dari jumlah orangnya — tinjau manual sebelum migrasi', bad;
  END IF;
END $$;
