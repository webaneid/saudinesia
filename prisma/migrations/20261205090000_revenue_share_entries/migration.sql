-- Fase 13c (docs/arsitektur-bagi-hasil.md §5c): hak bagi hasil Platform Provider per booking — append-only.
CREATE TYPE "revenue_share_source" AS ENUM ('payment', 'refund', 'revision', 'completion');

CREATE TABLE "revenue_share_entries" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "source" "revenue_share_source" NOT NULL,
  "refId" VARCHAR(80) NOT NULL,
  "amountIdr" DECIMAL(14,2) NOT NULL,
  "potentialIdr" DECIMAL(14,2) NOT NULL,
  "paidRatio" DECIMAL(7,6) NOT NULL,
  "entitledAfterIdr" DECIMAL(14,2) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok: kolom timestamptz
  CONSTRAINT "revenue_share_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "revenue_share_entries_shape" CHECK (
    "amountIdr" <> 0 AND "potentialIdr" >= 0 AND "paidRatio" >= 0 AND "paidRatio" <= 1
    AND "entitledAfterIdr" >= 0 AND "entitledAfterIdr" <= "potentialIdr"
  )
);

CREATE UNIQUE INDEX "revenue_share_entries_source_refId_key" ON "revenue_share_entries"("source", "refId");
CREATE INDEX "revenue_share_entries_bookingId_createdAt_idx" ON "revenue_share_entries"("bookingId", "createdAt");
CREATE INDEX "revenue_share_entries_createdAt_id_idx" ON "revenue_share_entries"("createdAt", "id");

ALTER TABLE "revenue_share_entries" ADD CONSTRAINT "revenue_share_entries_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "revenue_share_entries_frozen"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'revenue_share_entries append-only: % ditolak (koreksi = entri baru)', TG_OP;
END $$;
CREATE TRIGGER "revenue_share_entries_frozen_row" BEFORE UPDATE OR DELETE ON "revenue_share_entries" FOR EACH ROW EXECUTE FUNCTION "revenue_share_entries_frozen"();
CREATE TRIGGER "revenue_share_entries_frozen_truncate" BEFORE TRUNCATE ON "revenue_share_entries" FOR EACH STATEMENT EXECUTE FUNCTION "revenue_share_entries_frozen"();
