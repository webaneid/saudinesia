-- Booking Engine v2 Fase 6b (docs/arsitektur-booking-engine-v2.md §10.4): edit setelah terbit.
-- (1) T1 — baris price_snapshots dapat DIBATALKAN (void) oleh revisi, tetap ada sebagai jejak; satu-satunya UPDATE yang diizinkan = mengisi kolom void SEKALI.
-- (2) booking_revisions — riwayat revisi append-only (hanya catatan staf `reason` yang boleh dibersihkan, untuk penghapusan akun UU PDP).

ALTER TABLE "price_snapshots" ADD COLUMN "voidReason" TEXT,
ADD COLUMN "voidRevision" INTEGER,
ADD COLUMN "voidedAt" TIMESTAMPTZ(3),
ADD COLUMN "voidedById" TEXT;

-- Kolom void terisi bersama atau kosong bersama.
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_void_complete" CHECK (
  ("voidedAt" IS NULL AND "voidedById" IS NULL AND "voidReason" IS NULL AND "voidRevision" IS NULL)
  OR ("voidedAt" IS NOT NULL AND "voidedById" IS NOT NULL AND "voidReason" IS NOT NULL AND "voidRevision" IS NOT NULL AND "voidRevision" >= 2)
);

-- Trigger beku diganti: UPDATE ditolak KECUALI baris belum di-void, sesudahnya ter-void, dan SEMUA kolom lain identik.
CREATE OR REPLACE FUNCTION "price_snapshots_frozen"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."voidedAt" IS NULL AND NEW."voidedAt" IS NOT NULL
     AND (to_jsonb(NEW) - ARRAY['voidedAt','voidedById','voidReason','voidRevision']) = (to_jsonb(OLD) - ARRAY['voidedAt','voidedById','voidReason','voidRevision']) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'price_snapshots bersifat beku: koreksi harga ditulis sebagai baris baru; baris lama hanya dapat dibatalkan (void) sekali' USING ERRCODE = 'check_violation';
END;
$$;

CREATE TABLE "booking_revisions" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "reason" TEXT,
    "summary" JSONB NOT NULL DEFAULT '[]',
    "totalBefore" DECIMAL(14,2) NOT NULL,
    "totalAfter" DECIMAL(14,2) NOT NULL,
    "taxBefore" DECIMAL(14,2) NOT NULL,
    "taxAfter" DECIMAL(14,2) NOT NULL,
    "byUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok (timestamptz)

    CONSTRAINT "booking_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "booking_revisions_kind_valid" CHECK ("kind" IN ('items', 'total')),
    CONSTRAINT "booking_revisions_revision_min" CHECK ("revision" >= 2),
    CONSTRAINT "booking_revisions_summary_array" CHECK (jsonb_typeof("summary") = 'array')
);

CREATE UNIQUE INDEX "booking_revisions_bookingId_revision_key" ON "booking_revisions"("bookingId", "revision");
ALTER TABLE "booking_revisions" ADD CONSTRAINT "booking_revisions_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Append-only: hanya `reason` yang boleh diubah (dibersihkan saat penghapusan akun); DELETE hanya lewat cascade booking (draf tak punya revisi).
CREATE FUNCTION "booking_revisions_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'reason') = (to_jsonb(OLD) - 'reason') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'booking_revisions bersifat append-only (hanya catatan yang dapat dibersihkan)' USING ERRCODE = 'check_violation';
END;
$$;
CREATE TRIGGER "booking_revisions_no_update" BEFORE UPDATE ON "booking_revisions" FOR EACH ROW EXECUTE FUNCTION "booking_revisions_append_only"();
