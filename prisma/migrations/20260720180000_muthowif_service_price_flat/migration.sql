-- Integrasi HPP Muthowif (docs/arsitektur-muthowif.md §10): harga jual manual per-season diganti
-- satu harga flat, cache dari computeSellPrice(). Backfill dari priceRegular lama supaya
-- katalog tidak kosong selama admin belum isi HPP ulang (pola sama Transport §9 Fase 0).

ALTER TABLE "muthowif_service_price" ADD COLUMN "price" DECIMAL(12,2) NOT NULL DEFAULT 0;

UPDATE "muthowif_service_price" SET "price" = "priceRegular";

ALTER TABLE "muthowif_service_price" DROP COLUMN "priceHajj";
ALTER TABLE "muthowif_service_price" DROP COLUMN "priceRamadan";
ALTER TABLE "muthowif_service_price" DROP COLUMN "priceRegular";
