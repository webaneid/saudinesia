-- Fase 13d (docs/arsitektur-bagi-hasil.md §5d): Tandai selesai / Buka kembali booking + riwayat append-only.
ALTER TABLE "bookings" ADD COLUMN "completedAt" TIMESTAMPTZ(3), ADD COLUMN "completedById" TEXT, ADD COLUMN "completedPotentialIdr" DECIMAL(14,2);
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_completedById_fkey"
  FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Penanda selesai hanya pada booking berstatus completed (booking selesai lama hasil migrasi v1 boleh tanpa penanda).
-- Pelaku dan potensi beku hanya bersama penanda; potensi tak negatif.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_completed_shape" CHECK (
  ("completedAt" IS NULL OR "status" = 'completed')
  AND ("completedById" IS NULL OR "completedAt" IS NOT NULL)
  AND ("completedPotentialIdr" IS NULL OR ("completedAt" IS NOT NULL AND "completedPotentialIdr" >= 0))
);

CREATE TYPE "booking_completion_action" AS ENUM ('complete', 'reopen');

CREATE TABLE "booking_completion_events" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "action" "booking_completion_action" NOT NULL,
  "byUserId" TEXT NOT NULL,
  "potentialIdr" DECIMAL(14,2) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok: kolom timestamptz
  CONSTRAINT "booking_completion_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "booking_completion_events_shape" CHECK ("potentialIdr" >= 0)
);

CREATE INDEX "booking_completion_events_bookingId_createdAt_idx" ON "booking_completion_events"("bookingId", "createdAt");

ALTER TABLE "booking_completion_events" ADD CONSTRAINT "booking_completion_events_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_completion_events" ADD CONSTRAINT "booking_completion_events_byUserId_fkey"
  FOREIGN KEY ("byUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "booking_completion_events_frozen"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'booking_completion_events append-only: % ditolak', TG_OP;
END $$;
CREATE TRIGGER "booking_completion_events_frozen_row" BEFORE UPDATE OR DELETE ON "booking_completion_events" FOR EACH ROW EXECUTE FUNCTION "booking_completion_events_frozen"();
CREATE TRIGGER "booking_completion_events_frozen_truncate" BEFORE TRUNCATE ON "booking_completion_events" FOR EACH STATEMENT EXECUTE FUNCTION "booking_completion_events_frozen"();
