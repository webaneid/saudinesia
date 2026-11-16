-- Fase 7b-3: kode unik per invoice (docs/arsitektur-booking-engine-v2.md §10.10). Aditif; invoice lama tetap tanpa kode (NULL).
ALTER TABLE "invoices" ADD COLUMN "uniqueCode" INTEGER;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_unique_code_range" CHECK ("uniqueCode" IS NULL OR ("uniqueCode" >= 1 AND "uniqueCode" <= 9999));

ALTER TABLE "payments" ADD COLUMN "uniqueCodeIdr" INTEGER NOT NULL DEFAULT 0;
-- Kode unik hanya pada pembayaran terverifikasi (pending/ditolak tak membawa pemasukan).
ALTER TABLE "payments" ADD CONSTRAINT "payments_unique_code_check" CHECK ("uniqueCodeIdr" >= 0 AND "uniqueCodeIdr" <= 9999 AND ("uniqueCodeIdr" = 0 OR "status" = 'confirmed'));
