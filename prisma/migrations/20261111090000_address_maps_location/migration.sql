-- Lokasi Google Maps opsional untuk alamat (docs/arsitektur-hotel.md §12.5). Kolom nullable, tanpa backfill.
ALTER TABLE "addresses" ADD COLUMN "mapsUrl" TEXT,
ADD COLUMN "latitude" DECIMAL(9,6),
ADD COLUMN "longitude" DECIMAL(9,6);
