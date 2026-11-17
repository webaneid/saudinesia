-- Fase 8 (lanjutan, migrasi terpisah: nilai enum baru belum boleh dipakai di transaksi yang menambahkannya).
-- Bentuk akun: rekening = bankAccountId; kas tunai = systemKey; QRIS = qrisAccountId — tepat satu rujukan sesuai jenis.
ALTER TABLE "cash_accounts" DROP CONSTRAINT "cash_accounts_shape_check";
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_shape_check" CHECK (
  ("kind" = 'bank' AND "bankAccountId" IS NOT NULL AND "systemKey" IS NULL AND "qrisAccountId" IS NULL) OR
  ("kind" = 'cash' AND "bankAccountId" IS NULL AND "systemKey" IS NOT NULL AND "qrisAccountId" IS NULL) OR
  ("kind" = 'qris' AND "bankAccountId" IS NULL AND "systemKey" IS NULL AND "qrisAccountId" IS NOT NULL)
);
