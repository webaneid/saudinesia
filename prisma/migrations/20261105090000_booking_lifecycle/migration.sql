-- Siklus hidup booking (docs/arsitektur-booking-engine-v2.md §3.2/§10.1, Fase 3).
-- • enum booking_status: awaiting_payment|payment_review|confirmed|active|completed|cancelled → draft|active|completed|cancelled|expired
--   (awaiting_payment, payment_review, confirmed → active; "menunggu bayar"/"verifikasi"/"dikonfirmasi" kini TURUNAN dari pembayaran dan confirmedAt)
-- • kolom baru confirmedAt (timestamptz) + confirmedById; baris yang dulu confirmed/active/completed dibackfill
-- • departureDate/returnDate NULLABLE (tanggal acuan turunan dari item; draf belum punya)
-- Tidak ada data yang dihapus; pemetaan status deterministik. Konversi waktu eksplisit (kolom lama = timestamp UTC tanpa zona).

-- 1. Kolom baru + backfill (status lama masih terbaca di sini)
ALTER TABLE "bookings" ADD COLUMN "confirmedAt" TIMESTAMPTZ(3), ADD COLUMN "confirmedById" TEXT;

UPDATE "bookings" b SET
  "confirmedAt" = COALESCE(
    (SELECT max(p."confirmedAt") FROM "payments" p WHERE p."bookingId" = b."id" AND p."status" = 'confirmed') AT TIME ZONE 'UTC',
    b."updatedAt" AT TIME ZONE 'UTC'
  ),
  "confirmedById" = (
    SELECT p."confirmedById" FROM "payments" p
    WHERE p."bookingId" = b."id" AND p."status" = 'confirmed' AND p."confirmedById" IS NOT NULL
    ORDER BY p."confirmedAt" DESC NULLS LAST LIMIT 1
  )
WHERE b."status"::text IN ('confirmed', 'active', 'completed');

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Enum dibangun ulang dengan pemetaan eksplisit
ALTER TYPE "booking_status" RENAME TO "booking_status_old";
CREATE TYPE "booking_status" AS ENUM ('draft', 'active', 'completed', 'cancelled', 'expired');
ALTER TABLE "bookings" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "bookings" ALTER COLUMN "status" TYPE "booking_status" USING (
  CASE "status"::text
    WHEN 'awaiting_payment' THEN 'active'
    WHEN 'payment_review' THEN 'active'
    WHEN 'confirmed' THEN 'active'
    ELSE "status"::text
  END
)::"booking_status";
ALTER TABLE "bookings" ALTER COLUMN "status" SET DEFAULT 'active';
DROP TYPE "booking_status_old";

-- 3. Tanggal acuan turunan: boleh kosong (draf / belum ada item bertanggal)
ALTER TABLE "bookings" ALTER COLUMN "departureDate" DROP NOT NULL, ALTER COLUMN "returnDate" DROP NOT NULL;

-- 4. Draf tak pernah terkonfirmasi
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_draft_unconfirmed" CHECK (NOT ("status" = 'draft' AND "confirmedAt" IS NOT NULL));
