-- Fase 3 harga terpadu (docs/arsitektur-harga-terpadu.md §16). Atomik (satu transaksi migrasi); tidak menyentuh kolom harga lama.

-- 1. Audit harga manual di titik harga + jejak perubahan.
ALTER TABLE "price_points" ADD COLUMN "manualBy" TEXT, ADD COLUMN "manualAt" TIMESTAMP(3);

CREATE TABLE "price_changes" (
    "id" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "variantKey" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "oldSellIdr" DECIMAL(14,2),
    "newSellIdr" DECIMAL(14,2),
    "oldCostIdr" DECIMAL(14,2),
    "newCostIdr" DECIMAL(14,2),
    "note" TEXT,
    "byUserId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_changes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "price_changes_ownerType_ownerId_at_idx" ON "price_changes"("ownerType", "ownerId", "at");

-- 2. Ambang peringatan margin tipis (SEC-72 terkait: batas atas aturan margin dijaga di route + CHECK di sini).
ALTER TABLE "pricing_rules" ADD COLUMN "warnBelowPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_warn_non_negative" CHECK ("warnBelowPercent" >= 0);

-- 3. Tarif muthowif singleton dijaga DB. Dedupe: pertahankan baris yang punya biaya (lalu yang terbaru diubah, lalu id terkecil); buang sisanya
--    beserta baris polimorfik yatim-nya (biaya, vendor pilihan, titik harga).
DELETE FROM "muthowif_service_price"
WHERE "id" NOT IN (
  SELECT "id" FROM "muthowif_service_price" m
  ORDER BY EXISTS (SELECT 1 FROM "product_costs" c WHERE c."productType" = 'muthowif' AND c."productId" = m."id") DESC, m."updatedAt" DESC, m."id" ASC
  LIMIT 1
);
DELETE FROM "product_costs" WHERE "productType" = 'muthowif' AND "productId" NOT IN (SELECT "id" FROM "muthowif_service_price");
DELETE FROM "preferred_vendors" WHERE "productType" = 'muthowif' AND "productId" NOT IN (SELECT "id" FROM "muthowif_service_price");
DELETE FROM "price_points" WHERE "ownerType" = 'muthowif' AND "ownerId" NOT IN (SELECT "id" FROM "muthowif_service_price");
ALTER TABLE "muthowif_service_price" ADD COLUMN "singleton" BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX "muthowif_service_price_singleton_key" ON "muthowif_service_price"("singleton");
ALTER TABLE "muthowif_service_price" ADD CONSTRAINT "muthowif_service_price_is_singleton" CHECK ("singleton");

-- 4. Override jual Visa di JSON tier → harga manual titik harga (komponen pertama yang punya override menang, seperti computeSellPrice lama), lalu kunci
--    `sellPriceOverride` dibuang dari JSON. Titik harga varian itu sudah ada dari backfill Fase 2 (jual = override).
CREATE TEMP TABLE "_visa_overrides" ON COMMIT DROP AS
SELECT DISTINCT ON (c."productId", vk) c."productId" AS pid, vk, ov
FROM "product_costs" c
CROSS JOIN LATERAL (
  SELECT 'days:' || (t ->> 'minDays') || '-' || (t ->> 'maxDays') AS vk, (t ->> 'sellPriceOverride')::numeric AS ov
  FROM jsonb_array_elements(c."costTiers") t
  WHERE jsonb_typeof(t -> 'sellPriceOverride') = 'number' AND (t ->> 'sellPriceOverride')::numeric > 0
) o
WHERE c."productType" = 'visa' AND c."isActive" = true AND jsonb_typeof(c."costTiers") = 'array'
ORDER BY c."productId", vk, c."id";

INSERT INTO "price_changes" ("id", "ownerType", "ownerId", "variantKey", "kind", "newSellIdr", "note")
SELECT gen_random_uuid()::text, 'visa', o.pid, o.vk, 'visa_override_migrated', o.ov, 'Dipindah dari override jual per tier (Fase 3 harga terpadu)'
FROM "_visa_overrides" o
WHERE EXISTS (SELECT 1 FROM "price_points" p WHERE p."ownerType" = 'visa' AND p."ownerId" = o.pid AND p."variantKey" = o.vk);

UPDATE "price_points" p
SET "manualSellIdr" = o.ov, "sellIdr" = o.ov, "manualNote" = 'Dipindah dari override jual per tier (Fase 3 harga terpadu)', "manualAt" = now()
FROM "_visa_overrides" o
WHERE p."ownerType" = 'visa' AND p."ownerId" = o.pid AND p."variantKey" = o.vk;

UPDATE "product_costs"
SET "costTiers" = (SELECT COALESCE(jsonb_agg(t - 'sellPriceOverride'), '[]'::jsonb) FROM jsonb_array_elements("costTiers") t)
WHERE "productType" = 'visa' AND jsonb_typeof("costTiers") = 'array' AND "costTiers"::text LIKE '%sellPriceOverride%';
