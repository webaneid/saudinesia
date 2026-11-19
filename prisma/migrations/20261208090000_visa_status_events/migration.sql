-- Riwayat status visa per jamaah (docs/arsitektur-visa.md §9). Append-only; ditulis HANYA lib/visa/status.ts.

-- CreateTable
CREATE TABLE "visa_status_events" (
    "id" TEXT NOT NULL,
    "visaApplicationId" TEXT NOT NULL,
    "fromStatus" "visa_status",
    "toStatus" "visa_status" NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok (timestamptz)

    CONSTRAINT "visa_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visa_status_events_visaApplicationId_createdAt_idx" ON "visa_status_events"("visaApplicationId", "createdAt");

-- CreateIndex
CREATE INDEX "visa_status_events_actorId_idx" ON "visa_status_events"("actorId");

-- AddForeignKey
ALTER TABLE "visa_status_events" ADD CONSTRAINT "visa_status_events_visaApplicationId_fkey" FOREIGN KEY ("visaApplicationId") REFERENCES "visa_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_status_events" ADD CONSTRAINT "visa_status_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "visa_status_events" ADD CONSTRAINT "visa_status_events_changes" CHECK ("fromStatus" IS NULL OR "fromStatus" <> "toStatus");

-- ── Isi ulang dari kolom waktu yang SUDAH tercatat (kolom lama tanpa zona menyimpan UTC). Langkah lain tak punya waktu → tidak ditebak. ──
INSERT INTO "visa_status_events" ("id", "visaApplicationId", "fromStatus", "toStatus", "actorId", "createdAt")
SELECT gen_random_uuid()::text, "id", NULL, 'submitted_to_syarikah', NULL, "submittedAt" AT TIME ZONE 'UTC'
FROM "visa_applications" WHERE "submittedAt" IS NOT NULL;
INSERT INTO "visa_status_events" ("id", "visaApplicationId", "fromStatus", "toStatus", "actorId", "createdAt")
SELECT gen_random_uuid()::text, "id", NULL, 'issued', NULL, "issuedAt" AT TIME ZONE 'UTC'
FROM "visa_applications" WHERE "issuedAt" IS NOT NULL;

-- ── Append-only: hanya `actorId` di-NULL-kan (FK SET NULL) yang diizinkan; DELETE hanya sebagai cascade sesudah pengajuan visa induknya terhapus. ──
CREATE FUNCTION "visa_status_events_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM "visa_applications" WHERE "id" = OLD."visaApplicationId") THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'visa_status_events bersifat append-only (DELETE ditolak)';
  END IF;
  IF NEW."id" = OLD."id" AND NEW."visaApplicationId" = OLD."visaApplicationId"
     AND NEW."fromStatus" IS NOT DISTINCT FROM OLD."fromStatus" AND NEW."toStatus" = OLD."toStatus"
     AND NEW."createdAt" = OLD."createdAt"
     AND (NEW."actorId" IS NOT DISTINCT FROM OLD."actorId" OR NEW."actorId" IS NULL) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'visa_status_events bersifat append-only (UPDATE ditolak)';
END
$$;
CREATE TRIGGER "visa_status_events_no_change" BEFORE UPDATE OR DELETE ON "visa_status_events" FOR EACH ROW EXECUTE FUNCTION "visa_status_events_append_only"();
