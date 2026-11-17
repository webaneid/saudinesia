-- Halaman refund khusus (SEC-244, docs/arsitektur-booking-engine-v2.md §10.13): rekening tujuan pelanggan.
ALTER TABLE "refunds" ADD COLUMN "recipientBank" VARCHAR(80),
  ADD COLUMN "recipientAccountNumber" VARCHAR(40),
  ADD COLUMN "recipientAccountName" VARCHAR(120);

-- Semua-atau-tak-ada; nomor rekening hanya angka (spasi/strip diizinkan), tak kosong.
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_recipient_shape" CHECK (
  ("recipientBank" IS NULL AND "recipientAccountNumber" IS NULL AND "recipientAccountName" IS NULL)
  OR ("recipientBank" IS NOT NULL AND "recipientAccountNumber" IS NOT NULL AND "recipientAccountName" IS NOT NULL
      AND length(btrim("recipientBank")) > 0 AND length(btrim("recipientAccountName")) > 0
      AND "recipientAccountNumber" ~ '^[0-9][0-9 -]{3,38}[0-9]$')
);
