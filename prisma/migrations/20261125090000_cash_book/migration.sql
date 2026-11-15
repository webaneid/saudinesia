-- Buku kas minimal (docs/arsitektur-booking-engine-v2.md §10.10 Fase 7b-1). Tabel baru, tak ada data yang dipindah.
-- CreateEnum
CREATE TYPE "cash_account_kind" AS ENUM ('bank', 'cash');

-- CreateEnum
CREATE TYPE "cash_direction" AS ENUM ('in', 'out');

-- CreateEnum
CREATE TYPE "cash_component" AS ENUM ('pokok', 'ppn', 'kode_unik', 'kelebihan', 'refund', 'biaya_vendor', 'koreksi');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "destinationCashAccountId" TEXT;

-- CreateTable
CREATE TABLE "cash_accounts" (
    "id" TEXT NOT NULL,
    "kind" "cash_account_kind" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "bankAccountId" TEXT,
    "systemKey" VARCHAR(40),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok

    CONSTRAINT "cash_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_entries" (
    "id" TEXT NOT NULL,
    "entryDate" TIMESTAMPTZ(3) NOT NULL,
    "direction" "cash_direction" NOT NULL,
    "amountIdr" DECIMAL(14,2) NOT NULL,
    "component" "cash_component" NOT NULL,
    "cashAccountId" TEXT NOT NULL,
    "refType" VARCHAR(40) NOT NULL,
    "refId" TEXT NOT NULL,
    "bookingId" TEXT,
    "reversesEntryId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok

    CONSTRAINT "cash_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cash_accounts_bankAccountId_key" ON "cash_accounts"("bankAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "cash_accounts_systemKey_key" ON "cash_accounts"("systemKey");

-- CreateIndex
CREATE UNIQUE INDEX "cash_entries_reversesEntryId_key" ON "cash_entries"("reversesEntryId");

-- CreateIndex
CREATE INDEX "cash_entries_cashAccountId_entryDate_idx" ON "cash_entries"("cashAccountId", "entryDate");

-- CreateIndex
CREATE INDEX "cash_entries_bookingId_idx" ON "cash_entries"("bookingId");

-- CreateIndex
CREATE INDEX "cash_entries_entryDate_id_idx" ON "cash_entries"("entryDate", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_entries_refType_refId_component_key" ON "cash_entries"("refType", "refId", "component");

-- CreateIndex
CREATE INDEX "payments_destinationCashAccountId_idx" ON "payments"("destinationCashAccountId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_destinationCashAccountId_fkey" FOREIGN KEY ("destinationCashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_reversesEntryId_fkey" FOREIGN KEY ("reversesEntryId") REFERENCES "cash_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Bentuk akun: rekening = punya bankAccountId; kas tunai = punya systemKey.
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_shape_check" CHECK (
  ("kind" = 'bank' AND "bankAccountId" IS NOT NULL AND "systemKey" IS NULL) OR
  ("kind" = 'cash' AND "bankAccountId" IS NULL AND "systemKey" IS NOT NULL)
);

-- Entri: jumlah positif; entri pembalik berkomponen 'koreksi' dan selalu merujuk entri asal.
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_amount_check" CHECK ("amountIdr" > 0);
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_reversal_check" CHECK ((("refType" = 'reversal') = ("reversesEntryId" IS NOT NULL)));

-- APPEND-ONLY: buku kas tidak pernah diubah atau dihapus; koreksi = entri pembalik.
CREATE FUNCTION "cash_entries_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'cash_entries bersifat append-only (%), koreksi lewat entri pembalik', TG_OP;
END;
$$;
CREATE TRIGGER "cash_entries_no_update" BEFORE UPDATE OR DELETE ON "cash_entries" FOR EACH ROW EXECUTE FUNCTION "cash_entries_append_only"();
CREATE TRIGGER "cash_entries_no_truncate" BEFORE TRUNCATE ON "cash_entries" FOR EACH STATEMENT EXECUTE FUNCTION "cash_entries_append_only"();
