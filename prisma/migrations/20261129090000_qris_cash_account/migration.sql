-- Fase 8: akun kas QRIS (docs/arsitektur-booking-engine-v2.md §10.11 butir 4). Aditif.
ALTER TYPE "cash_account_kind" ADD VALUE 'qris';

ALTER TABLE "cash_accounts" ADD COLUMN "qrisAccountId" TEXT;
CREATE UNIQUE INDEX "cash_accounts_qrisAccountId_key" ON "cash_accounts"("qrisAccountId");
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_qrisAccountId_fkey" FOREIGN KEY ("qrisAccountId") REFERENCES "qris_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
