-- Fase 6 modul jamaah (docs/arsitektur-jamaah.md §8.4): status pengajuan jamaah booking, riwayat append-only, dokumen yang dipakai pengajuan.

-- CreateEnum
CREATE TYPE "pilgrim_review_status" AS ENUM ('draft', 'submitted', 'needs_revision', 'verified');

-- AlterTable
ALTER TABLE "booking_pilgrims" ADD COLUMN     "reviewStatus" "pilgrim_review_status" NOT NULL DEFAULT 'draft',
ADD COLUMN     "submittedAt" TIMESTAMPTZ(3),
ADD COLUMN     "verifiedAt" TIMESTAMPTZ(3),
ADD COLUMN     "verifiedById" TEXT;

-- CreateTable
CREATE TABLE "pilgrim_review_events" (
    "id" TEXT NOT NULL,
    "bookingPilgrimId" TEXT NOT NULL,
    "fromStatus" "pilgrim_review_status",
    "toStatus" "pilgrim_review_status" NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok (timestamptz)

    CONSTRAINT "pilgrim_review_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_pilgrim_documents" (
    "bookingPilgrimId" TEXT NOT NULL,
    "pilgrimDocumentId" TEXT NOT NULL,
    "attachedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok (timestamptz)

    CONSTRAINT "booking_pilgrim_documents_pkey" PRIMARY KEY ("bookingPilgrimId","pilgrimDocumentId")
);

-- CreateIndex
CREATE INDEX "pilgrim_review_events_bookingPilgrimId_createdAt_idx" ON "pilgrim_review_events"("bookingPilgrimId", "createdAt");

-- CreateIndex
CREATE INDEX "pilgrim_review_events_actorId_idx" ON "pilgrim_review_events"("actorId");

-- CreateIndex
CREATE INDEX "booking_pilgrim_documents_pilgrimDocumentId_idx" ON "booking_pilgrim_documents"("pilgrimDocumentId");

-- CreateIndex
CREATE INDEX "booking_pilgrims_reviewStatus_submittedAt_idx" ON "booking_pilgrims"("reviewStatus", "submittedAt");

-- CreateIndex
CREATE INDEX "booking_pilgrims_verifiedById_idx" ON "booking_pilgrims"("verifiedById");

-- AddForeignKey
ALTER TABLE "booking_pilgrims" ADD CONSTRAINT "booking_pilgrims_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pilgrim_review_events" ADD CONSTRAINT "pilgrim_review_events_bookingPilgrimId_fkey" FOREIGN KEY ("bookingPilgrimId") REFERENCES "booking_pilgrims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pilgrim_review_events" ADD CONSTRAINT "pilgrim_review_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_pilgrim_documents" ADD CONSTRAINT "booking_pilgrim_documents_bookingPilgrimId_fkey" FOREIGN KEY ("bookingPilgrimId") REFERENCES "booking_pilgrims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_pilgrim_documents" ADD CONSTRAINT "booking_pilgrim_documents_pilgrimDocumentId_fkey" FOREIGN KEY ("pilgrimDocumentId") REFERENCES "pilgrim_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Bentuk status (sejajar lib/pilgrims/review.ts) ──
ALTER TABLE "booking_pilgrims"
  ADD CONSTRAINT "booking_pilgrims_verified_at" CHECK (("reviewStatus" = 'verified') = ("verifiedAt" IS NOT NULL)),
  ADD CONSTRAINT "booking_pilgrims_submitted_at" CHECK ("reviewStatus" = 'draft' OR "submittedAt" IS NOT NULL),
  ADD CONSTRAINT "booking_pilgrims_verified_by" CHECK ("verifiedById" IS NULL OR "reviewStatus" = 'verified');

-- ── Riwayat append-only: hanya `note` dikosongkan (hapus akun) dan `actorId` di-NULL-kan (FK SET NULL) yang diizinkan;
--    DELETE hanya sebagai cascade sesudah jamaah booking induknya terhapus. ──
CREATE FUNCTION "pilgrim_review_events_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM "booking_pilgrims" WHERE "id" = OLD."bookingPilgrimId") THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'pilgrim_review_events bersifat append-only (DELETE ditolak)';
  END IF;
  IF NEW."id" = OLD."id" AND NEW."bookingPilgrimId" = OLD."bookingPilgrimId"
     AND NEW."fromStatus" IS NOT DISTINCT FROM OLD."fromStatus" AND NEW."toStatus" = OLD."toStatus"
     AND NEW."createdAt" = OLD."createdAt"
     AND (NEW."actorId" IS NOT DISTINCT FROM OLD."actorId" OR NEW."actorId" IS NULL)
     AND (NEW."note" IS NOT DISTINCT FROM OLD."note" OR NEW."note" IS NULL) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'pilgrim_review_events bersifat append-only (UPDATE ditolak)';
END
$$;
CREATE TRIGGER "pilgrim_review_events_no_change" BEFORE UPDATE OR DELETE ON "pilgrim_review_events" FOR EACH ROW EXECUTE FUNCTION "pilgrim_review_events_append_only"();

ALTER TABLE "pilgrim_review_events" ADD CONSTRAINT "pilgrim_review_events_note_length" CHECK ("note" IS NULL OR length("note") <= 2000);
