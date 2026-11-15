-- Fase 7a (docs/arsitektur-booking-engine-v2.md §10.7): data transfer dari pelanggan. Aditif — kolom lama tak diubah.
ALTER TABLE "payments"
  ADD COLUMN "claimedAmountIdr" DECIMAL(14,2),
  ADD COLUMN "transferredAt" TIMESTAMPTZ(3),
  ADD COLUMN "senderBank" VARCHAR(100),
  ADD COLUMN "senderAccountName" VARCHAR(100),
  ADD COLUMN "destinationLabel" VARCHAR(200),
  ADD COLUMN "payerNote" VARCHAR(500);

-- Nominal yang diisi pelanggan selalu positif.
ALTER TABLE "payments" ADD CONSTRAINT "payments_claimed_amount_positive" CHECK ("claimedAmountIdr" IS NULL OR "claimedAmountIdr" > 0);
