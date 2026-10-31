-- Status kuota PER BARIS item (docs/arsitektur-booking-engine-v2.md §10.4 6b, koreksi pemilik 2026-11-01): produk yang ditambahkan lewat revisi sesudah booking dikonfirmasi
-- tetap `pending` (tidak langsung `booked`). Pelepasan dan konfirmasi kuota membaca kolom ini, bukan `bookings.confirmedAt`.
-- Backfill: baris milik booking yang SUDAH dikonfirmasi = kuotanya sudah `booked` (konfirmasi pembayaran v1 mengonfirmasi semua baris sekaligus).

ALTER TABLE "booking_hotels" ADD COLUMN "quotaConfirmed" BOOLEAN NOT NULL DEFAULT false;
UPDATE "booking_hotels" x SET "quotaConfirmed" = true FROM "bookings" b WHERE b."id" = x."bookingId" AND b."confirmedAt" IS NOT NULL;
ALTER TABLE "booking_transports" ADD COLUMN "quotaConfirmed" BOOLEAN NOT NULL DEFAULT false;
UPDATE "booking_transports" x SET "quotaConfirmed" = true FROM "bookings" b WHERE b."id" = x."bookingId" AND b."confirmedAt" IS NOT NULL;
ALTER TABLE "booking_muthowif" ADD COLUMN "quotaConfirmed" BOOLEAN NOT NULL DEFAULT false;
UPDATE "booking_muthowif" x SET "quotaConfirmed" = true FROM "bookings" b WHERE b."id" = x."bookingId" AND b."confirmedAt" IS NOT NULL;
ALTER TABLE "booking_tour_packages" ADD COLUMN "quotaConfirmed" BOOLEAN NOT NULL DEFAULT false;
UPDATE "booking_tour_packages" x SET "quotaConfirmed" = true FROM "bookings" b WHERE b."id" = x."bookingId" AND b."confirmedAt" IS NOT NULL;
ALTER TABLE "booking_haji" ADD COLUMN "quotaConfirmed" BOOLEAN NOT NULL DEFAULT false;
UPDATE "booking_haji" x SET "quotaConfirmed" = true FROM "bookings" b WHERE b."id" = x."bookingId" AND b."confirmedAt" IS NOT NULL;
ALTER TABLE "booking_flights" ADD COLUMN "quotaConfirmed" BOOLEAN NOT NULL DEFAULT false;
UPDATE "booking_flights" x SET "quotaConfirmed" = true FROM "bookings" b WHERE b."id" = x."bookingId" AND b."confirmedAt" IS NOT NULL;
ALTER TABLE "booking_packages" ADD COLUMN "quotaConfirmed" BOOLEAN NOT NULL DEFAULT false;
UPDATE "booking_packages" x SET "quotaConfirmed" = true FROM "bookings" b WHERE b."id" = x."bookingId" AND b."confirmedAt" IS NOT NULL;

-- Fail-closed: tak ada baris berkonfirmasi tanpa booking dikonfirmasi, tak ada baris booking dikonfirmasi yang tertinggal.
DO $$
DECLARE bad int := 0; n int;
BEGIN
  SELECT count(*) INTO n FROM "booking_hotels" x JOIN "bookings" b ON b."id" = x."bookingId" WHERE x."quotaConfirmed" IS DISTINCT FROM (b."confirmedAt" IS NOT NULL); bad := bad + n;
  SELECT count(*) INTO n FROM "booking_transports" x JOIN "bookings" b ON b."id" = x."bookingId" WHERE x."quotaConfirmed" IS DISTINCT FROM (b."confirmedAt" IS NOT NULL); bad := bad + n;
  SELECT count(*) INTO n FROM "booking_muthowif" x JOIN "bookings" b ON b."id" = x."bookingId" WHERE x."quotaConfirmed" IS DISTINCT FROM (b."confirmedAt" IS NOT NULL); bad := bad + n;
  SELECT count(*) INTO n FROM "booking_tour_packages" x JOIN "bookings" b ON b."id" = x."bookingId" WHERE x."quotaConfirmed" IS DISTINCT FROM (b."confirmedAt" IS NOT NULL); bad := bad + n;
  SELECT count(*) INTO n FROM "booking_haji" x JOIN "bookings" b ON b."id" = x."bookingId" WHERE x."quotaConfirmed" IS DISTINCT FROM (b."confirmedAt" IS NOT NULL); bad := bad + n;
  SELECT count(*) INTO n FROM "booking_flights" x JOIN "bookings" b ON b."id" = x."bookingId" WHERE x."quotaConfirmed" IS DISTINCT FROM (b."confirmedAt" IS NOT NULL); bad := bad + n;
  SELECT count(*) INTO n FROM "booking_packages" x JOIN "bookings" b ON b."id" = x."bookingId" WHERE x."quotaConfirmed" IS DISTINCT FROM (b."confirmedAt" IS NOT NULL); bad := bad + n;
  IF bad > 0 THEN RAISE EXCEPTION 'item_quota_confirmed: % baris tidak sesuai status konfirmasi booking', bad; END IF;
END $$;
