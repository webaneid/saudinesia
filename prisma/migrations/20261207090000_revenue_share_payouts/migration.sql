-- Fase 13e-1 (docs/arsitektur-bagi-hasil.md §5e): rekening Platform Provider + pencairan bagi hasil lewat buku kas. Aditif.
ALTER TYPE "cash_component" ADD VALUE 'bagi_hasil';

CREATE TABLE "platform_provider_bank_accounts" (
  "id" TEXT NOT NULL,
  "bankName" VARCHAR(100) NOT NULL,
  "accountNumber" VARCHAR(40) NOT NULL,
  "accountHolder" VARCHAR(120) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok: kolom timestamptz
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "platform_provider_bank_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_provider_bank_accounts_shape" CHECK (
    length(btrim("bankName")) > 0 AND "accountNumber" ~ '^[0-9]{4,40}$' AND length(btrim("accountHolder")) > 0
  )
);
CREATE UNIQUE INDEX "platform_provider_bank_accounts_bankName_accountNumber_key" ON "platform_provider_bank_accounts"("bankName", "accountNumber");

CREATE TABLE "revenue_share_payouts" (
  "id" TEXT NOT NULL,
  "amountIdr" DECIMAL(14,2) NOT NULL,
  "paidAt" TIMESTAMPTZ(3) NOT NULL,
  "cashAccountId" TEXT NOT NULL,
  "recipientAccountId" TEXT NOT NULL,
  "recipientBankName" VARCHAR(100) NOT NULL,
  "recipientNumber" VARCHAR(40) NOT NULL,
  "recipientHolder" VARCHAR(120) NOT NULL,
  "note" VARCHAR(200),
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok: kolom timestamptz
  "voidedAt" TIMESTAMPTZ(3),
  "voidedById" TEXT,
  "voidReason" VARCHAR(200),
  CONSTRAINT "revenue_share_payouts_pkey" PRIMARY KEY ("id"),
  -- Jumlah > 0; batal = waktu + pelaku + alasan sekaligus.
  CONSTRAINT "revenue_share_payouts_shape" CHECK (
    "amountIdr" > 0
    AND ("voidedAt" IS NULL) = ("voidedById" IS NULL)
    AND ("voidedAt" IS NULL) = ("voidReason" IS NULL)
  )
);
CREATE INDEX "revenue_share_payouts_paidAt_id_idx" ON "revenue_share_payouts"("paidAt", "id");

ALTER TABLE "revenue_share_payouts" ADD CONSTRAINT "revenue_share_payouts_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "revenue_share_payouts" ADD CONSTRAINT "revenue_share_payouts_recipientAccountId_fkey" FOREIGN KEY ("recipientAccountId") REFERENCES "platform_provider_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "revenue_share_payouts" ADD CONSTRAINT "revenue_share_payouts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "revenue_share_payouts" ADD CONSTRAINT "revenue_share_payouts_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Beku (pola cash_transfers_frozen): tak pernah dihapus/diubah; satu-satunya perubahan sah = pembatalan SEKALI.
CREATE FUNCTION "revenue_share_payouts_frozen"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'revenue_share_payouts frozen: % ditolak (batal = voidedAt + entri pembalik)', TG_OP;
  END IF;
  IF OLD."voidedAt" IS NOT NULL OR NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."amountIdr" IS DISTINCT FROM OLD."amountIdr" OR NEW."paidAt" IS DISTINCT FROM OLD."paidAt"
     OR NEW."cashAccountId" IS DISTINCT FROM OLD."cashAccountId" OR NEW."recipientAccountId" IS DISTINCT FROM OLD."recipientAccountId"
     OR NEW."recipientBankName" IS DISTINCT FROM OLD."recipientBankName" OR NEW."recipientNumber" IS DISTINCT FROM OLD."recipientNumber"
     OR NEW."recipientHolder" IS DISTINCT FROM OLD."recipientHolder" OR NEW."note" IS DISTINCT FROM OLD."note"
     OR NEW."createdById" IS DISTINCT FROM OLD."createdById" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
     OR NEW."voidedAt" IS NULL THEN
    RAISE EXCEPTION 'revenue_share_payouts frozen: hanya pembatalan sekali yang diizinkan';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "revenue_share_payouts_frozen" BEFORE UPDATE OR DELETE ON "revenue_share_payouts" FOR EACH ROW EXECUTE FUNCTION "revenue_share_payouts_frozen"();
CREATE TRIGGER "revenue_share_payouts_no_truncate" BEFORE TRUNCATE ON "revenue_share_payouts" FOR EACH STATEMENT EXECUTE FUNCTION "revenue_share_payouts_frozen"();
