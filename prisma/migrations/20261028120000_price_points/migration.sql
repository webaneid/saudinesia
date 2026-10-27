-- Fase 1 harga terpadu (docs/arsitektur-harga-terpadu.md §3, §14): satu tabel titik harga, ditulis hanya oleh lib/pricing/engine.
-- Ekspansi murni: tabel baru, tidak menyentuh kolom harga lama (kolom lama tetap ditulis ganda sampai Fase 5).

CREATE TABLE "price_points" (
    "id" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "variantKey" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL,
    "costIdr" DECIMAL(14,2),
    "autoSellIdr" DECIMAL(14,2),
    "manualSellIdr" DECIMAL(14,2),
    "sellIdr" DECIMAL(14,2) NOT NULL,
    "marginPctUsed" DECIMAL(5,2),
    "roundingUsed" INTEGER,
    "fxRateIds" JSONB NOT NULL DEFAULT '[]',
    "vendorIds" JSONB NOT NULL DEFAULT '[]',
    "manualNote" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_points_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "price_points_ownerType_ownerId_idx" ON "price_points"("ownerType", "ownerId");
CREATE UNIQUE INDEX "price_points_ownerType_ownerId_variantKey_key" ON "price_points"("ownerType", "ownerId", "variantKey");

-- Invarian I2 dijaga DB, bukan hanya kode: jual efektif = manual ?? otomatis, minimal salah satunya ada, tidak ada nominal negatif.
ALTER TABLE "price_points" ADD CONSTRAINT "price_points_sell_is_manual_or_auto"
    CHECK ("sellIdr" = COALESCE("manualSellIdr", "autoSellIdr") AND ("manualSellIdr" IS NOT NULL OR "autoSellIdr" IS NOT NULL));
ALTER TABLE "price_points" ADD CONSTRAINT "price_points_non_negative"
    CHECK ("sellIdr" >= 0 AND COALESCE("costIdr", 0) >= 0 AND COALESCE("autoSellIdr", 0) >= 0 AND COALESCE("manualSellIdr", 0) >= 0);
