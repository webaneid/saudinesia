-- Fase 12b (docs/arsitektur-booking-engine-v2.md §10.14): transfer antar akun kas. Aditif; komponen kas baru + tabel transfer.
ALTER TYPE "cash_component" ADD VALUE 'pindah_akun';
ALTER TYPE "cash_component" ADD VALUE 'biaya_transfer';

CREATE TABLE "cash_transfers" (
    "id" TEXT NOT NULL,
    "fromAccountId" TEXT NOT NULL,
    "toAccountId" TEXT NOT NULL,
    "amountIdr" DECIMAL(14,2) NOT NULL,
    "feeIdr" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "transferredAt" TIMESTAMPTZ(3) NOT NULL,
    "note" VARCHAR(200),
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok (kolom timestamptz)
    "voidedAt" TIMESTAMPTZ(3),
    "voidedById" TEXT,
    "voidReason" VARCHAR(200),

    CONSTRAINT "cash_transfers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cash_transfers_transferredAt_id_idx" ON "cash_transfers"("transferredAt", "id");
CREATE INDEX "cash_transfers_fromAccountId_idx" ON "cash_transfers"("fromAccountId");
CREATE INDEX "cash_transfers_toAccountId_idx" ON "cash_transfers"("toAccountId");

ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_fromAccountId_fkey" FOREIGN KEY ("fromAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Bentuk: akun berbeda, jumlah > 0, biaya ≥ 0, batal = waktu + pelaku sekaligus (alasan hanya bila batal).
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_shape" CHECK (
  "fromAccountId" <> "toAccountId"
  AND "amountIdr" > 0
  AND "feeIdr" >= 0
  AND ("voidedAt" IS NULL) = ("voidedById" IS NULL)
  AND ("voidReason" IS NULL OR "voidedAt" IS NOT NULL)
);

-- Beku (SEC-269): transfer tak pernah dihapus atau diubah; satu-satunya perubahan yang sah = pembatalan SEKALI (voidedAt/voidedById/voidReason NULL → terisi).
-- Menjaga cash_transfers selaras dengan cash_entries yang append-only (pola price_snapshots_frozen).
CREATE FUNCTION "cash_transfers_frozen"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'cash_transfers frozen: DELETE ditolak (batal = voidedAt + entri pembalik)';
  END IF;
  IF OLD."voidedAt" IS NOT NULL
     OR NEW."fromAccountId" IS DISTINCT FROM OLD."fromAccountId" OR NEW."toAccountId" IS DISTINCT FROM OLD."toAccountId"
     OR NEW."amountIdr" IS DISTINCT FROM OLD."amountIdr" OR NEW."feeIdr" IS DISTINCT FROM OLD."feeIdr"
     OR NEW."transferredAt" IS DISTINCT FROM OLD."transferredAt" OR NEW."note" IS DISTINCT FROM OLD."note"
     OR NEW."createdById" IS DISTINCT FROM OLD."createdById" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
     OR NEW."voidedAt" IS NULL THEN
    RAISE EXCEPTION 'cash_transfers frozen: hanya pembatalan sekali yang diizinkan';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "cash_transfers_frozen" BEFORE UPDATE OR DELETE ON "cash_transfers" FOR EACH ROW EXECUTE FUNCTION "cash_transfers_frozen"();
CREATE TRIGGER "cash_transfers_no_truncate" BEFORE TRUNCATE ON "cash_transfers" FOR EACH STATEMENT EXECUTE FUNCTION "cash_transfers_frozen"();
