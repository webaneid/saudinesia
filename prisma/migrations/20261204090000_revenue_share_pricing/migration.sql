-- Fase 13b (docs/arsitektur-bagi-hasil.md): bagi hasil beku di invoice + penanda aturan yang sudah diterapkan ke harga.
-- Invoice lama tetap NULL (belum ada kesepakatan bagi hasil saat terbit) — tidak ada data yang diubah.
ALTER TABLE "invoices"
  ADD COLUMN "revenueSharePercent" DECIMAL(5,2),
  ADD COLUMN "revenueShareBasis" "revenue_share_basis",
  ADD COLUMN "revenueShareSettingId" TEXT;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_revenue_share_shape" CHECK (
  ("revenueSharePercent" IS NULL) = ("revenueShareBasis" IS NULL)
  AND ("revenueShareSettingId" IS NULL OR "revenueSharePercent" IS NOT NULL)
  AND ("revenueSharePercent" IS NULL OR ("revenueSharePercent" >= 0 AND "revenueSharePercent" <= 50))
);

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_revenueShareSettingId_fkey"
  FOREIGN KEY ("revenueShareSettingId") REFERENCES "revenue_share_settings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "revenue_share_pricing_state" (
  "id" TEXT NOT NULL,
  "ruleKey" VARCHAR(40) NOT NULL,
  "percent" DECIMAL(5,2),
  "basis" "revenue_share_basis",
  "settingId" TEXT,
  "appliedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "revenue_share_pricing_state_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "revenue_share_pricing_state_shape" CHECK (
    ("percent" IS NULL) = ("basis" IS NULL) AND ("ruleKey" = 'none') = ("percent" IS NULL)
    AND ("percent" IS NULL OR ("percent" >= 0 AND "percent" <= 50))
  )
);
