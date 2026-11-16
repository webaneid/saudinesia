-- Refund & pembatalan oleh admin (docs/arsitektur-booking-engine-v2.md §10.10 Fase 7b-2a). Kolom/tabel baru; baris refund lama tetap (source = cancellation).
-- CreateEnum
CREATE TYPE "refund_source" AS ENUM ('cancellation', 'overpayment');

-- CreateEnum
CREATE TYPE "cancel_money_decision" AS ENUM ('none', 'refund', 'retain', 'defer');

-- AlterTable
ALTER TABLE "refunds" ADD COLUMN     "cashAccountId" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "paidById" TEXT,
ADD COLUMN     "rejectedAt" TIMESTAMPTZ(3),
ADD COLUMN     "rejectedById" TEXT,
ADD COLUMN     "source" "refund_source" NOT NULL DEFAULT 'cancellation';

-- CreateTable
CREATE TABLE "booking_cancellations" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "cancelledAt" TIMESTAMPTZ(3) NOT NULL,
    "cancelledById" TEXT,
    "byCustomer" BOOLEAN NOT NULL DEFAULT false,
    "reason" VARCHAR(500) NOT NULL,
    "paidIdr" DECIMAL(14,2) NOT NULL,
    "decision" "cancel_money_decision" NOT NULL,
    "decidedAt" TIMESTAMPTZ(3),
    "decidedById" TEXT,
    "decisionNote" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "booking_cancellations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "booking_cancellations_bookingId_key" ON "booking_cancellations"("bookingId");

-- CreateIndex
CREATE INDEX "refunds_bookingId_idx" ON "refunds"("bookingId");

-- CreateIndex
CREATE INDEX "refunds_status_createdAt_idx" ON "refunds"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_cancellations" ADD CONSTRAINT "booking_cancellations_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Refund: jumlah positif; yang DIBAYAR selalu punya akun kas dan waktu bayar (uang keluarnya tercatat di buku kas). Baris lama `paid` tanpa akun ditolak di sini — fail-closed.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "refunds" WHERE "status" = 'paid') THEN
    RAISE EXCEPTION 'Ada refund berstatus paid tanpa akun kas — petakan dulu sebelum migrasi ini';
  END IF;
  -- Refund terbuka v1 dihitung dari TAGIHAN (bukan uang masuk) dan akan menghabiskan batas refund baru / memblokir hapus akun → petakan manual dulu.
  IF EXISTS (SELECT 1 FROM "refunds" WHERE "status" IN ('pending', 'approved')) THEN
    RAISE EXCEPTION 'Ada refund pending/approved dari alur lama — tinjau (tolak/petakan) sebelum migrasi ini';
  END IF;
END $$;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_check" CHECK ("amount" > 0);
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paid_check" CHECK ("status" <> 'paid' OR ("cashAccountId" IS NOT NULL AND "paidAt" IS NOT NULL));

-- Pembatalan: terbayar tak negatif; tanpa uang ⇔ keputusan 'none'.
ALTER TABLE "booking_cancellations" ADD CONSTRAINT "booking_cancellations_paid_check" CHECK ("paidIdr" >= 0);
ALTER TABLE "booking_cancellations" ADD CONSTRAINT "booking_cancellations_decision_check" CHECK ((("paidIdr" = 0) = ("decision" = 'none')));
