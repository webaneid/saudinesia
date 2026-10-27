-- docs/arsitektur-media.md — FASE KONTRAKSI (F4). Setelah tidak ada kode yang membaca/menulis kolom foto per-model, hapus kolom lamanya.
-- `product_images` (diisi migrasi ekspansi 20261027120000 dan dikelola layanan media sejak itu) adalah SATU-SATUNYA sumber foto. Kolom lama tidak
-- pernah ditulis setelah ekspansi, jadi isinya hanya salinan beku: kunci yang tak ada di `product_images` berarti fotonya sudah dihapus lewat
-- layanan (objek MinIO ikut terhapus) — mengisi ulang justru akan menghidupkan kunci yatim, maka TIDAK ada pengisian ulang di sini.
-- Pengaman: kontraksi hanya berjalan bila `product_images` ada (ekspansi sudah diterapkan).

DO $$
BEGIN
  IF to_regclass('public.product_images') IS NULL THEN
    RAISE EXCEPTION 'Migrasi kontraksi media DIBATALKAN: tabel product_images belum ada (terapkan migrasi ekspansi lebih dulu).';
  END IF;
END $$;

ALTER TABLE "hotels" DROP COLUMN "images", DROP COLUMN "featuredImageKey";
ALTER TABLE "transport_vehicles" DROP COLUMN "images";
ALTER TABLE "muthowif" DROP COLUMN "photoKey";
ALTER TABLE "tourism_sites" DROP COLUMN "photoKey";
ALTER TABLE "haji_products" DROP COLUMN "images";
ALTER TABLE "packages" DROP COLUMN "images";
