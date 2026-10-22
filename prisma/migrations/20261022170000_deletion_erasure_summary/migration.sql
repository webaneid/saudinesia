-- Penghapusan akun UU PDP (SEC-44): ringkasan penghapusan (jumlah baris, tanpa PII) sebagai bukti akuntabilitas.
ALTER TABLE "account_deletion_requests" ADD COLUMN "erasureSummary" JSONB;
