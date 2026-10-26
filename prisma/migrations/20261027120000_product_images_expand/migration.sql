-- docs/arsitektur-media.md — FASE EKSPANSI (F1): tabel foto produk universal + pengisian dari kolom foto lama per-model. Kolom lama TETAP ada
-- (hanya dibaca migrasi ini) dan dibuang di fase kontraksi. FAIL-CLOSED: elemen `images` yang bukan teks, atau kunci objek ganda, membatalkan
-- SELURUH migrasi (Prisma menjalankan skrip ini sebagai satu transaksi). Berkas MinIO tidak disalin atau diubah — hanya kunci yang dicatat.

CREATE TABLE "product_images" (
    "id" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "cardKey" TEXT,
    "alt" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_images_key_key" ON "product_images"("key");
CREATE INDEX "product_images_productType_productId_sortOrder_idx" ON "product_images"("productType", "productId", "sortOrder");

DO $$
DECLARE
  bad bigint;
  dup text;
BEGIN
  -- Galeri lama harus berupa array JSON berisi teks.
  SELECT count(*) INTO bad FROM (
    SELECT jsonb_array_elements(images::jsonb) AS e FROM "hotels"
    UNION ALL SELECT jsonb_array_elements(images::jsonb) FROM "transport_vehicles"
  ) x WHERE jsonb_typeof(e) <> 'string';
  IF bad > 0 THEN
    RAISE EXCEPTION 'Migrasi media DIBATALKAN: % elemen images (hotels/transport_vehicles) bukan teks. Perbaiki datanya lebih dulu.', bad;
  END IF;

  -- Hotel: galeri berurutan; sampul = featuredImageKey bila ada di galeri/di luar galeri, selain itu foto pertama.
  INSERT INTO "product_images" ("id", "productType", "productId", "key", "sortOrder", "isFeatured")
  SELECT gen_random_uuid()::text, 'hotel', h.id, g.k, (g.ord - 1)::int,
         (g.k = coalesce(h."featuredImageKey", first_value(g.k) OVER (PARTITION BY h.id ORDER BY g.ord)))
  FROM "hotels" h
  CROSS JOIN LATERAL jsonb_array_elements_text(h.images::jsonb) WITH ORDINALITY AS g(k, ord);

  -- Sampul hotel yang tak ada di galeri: tambahkan sebagai foto terakhir yang ditandai sampul (baris galeri di atas tak ada yang sampul pada kasus ini).
  INSERT INTO "product_images" ("id", "productType", "productId", "key", "sortOrder", "isFeatured")
  SELECT gen_random_uuid()::text, 'hotel', h.id, h."featuredImageKey",
         coalesce((SELECT max("sortOrder") + 1 FROM "product_images" WHERE "productType" = 'hotel' AND "productId" = h.id), 0), true
  FROM "hotels" h
  WHERE h."featuredImageKey" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "product_images" f WHERE f."productType" = 'hotel' AND f."productId" = h.id AND f.key = h."featuredImageKey");

  -- Kendaraan: galeri berurutan, foto pertama = sampul (katalog lama memakai foto pertama sebagai sampul).
  INSERT INTO "product_images" ("id", "productType", "productId", "key", "sortOrder", "isFeatured")
  SELECT gen_random_uuid()::text, 'vehicle', v.id, g.k, (g.ord - 1)::int, (g.ord = 1)
  FROM "transport_vehicles" v
  CROSS JOIN LATERAL jsonb_array_elements_text(v.images::jsonb) WITH ORDINALITY AS g(k, ord);

  -- Muthowif dan Situs Wisata: satu foto = sampul.
  INSERT INTO "product_images" ("id", "productType", "productId", "key", "sortOrder", "isFeatured")
  SELECT gen_random_uuid()::text, 'muthowif', id, "photoKey", 0, true FROM "muthowif" WHERE "photoKey" IS NOT NULL;
  INSERT INTO "product_images" ("id", "productType", "productId", "key", "sortOrder", "isFeatured")
  SELECT gen_random_uuid()::text, 'tourism_site', id, "photoKey", 0, true FROM "tourism_sites" WHERE "photoKey" IS NOT NULL;
END $$;
