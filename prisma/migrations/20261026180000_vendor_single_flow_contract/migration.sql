-- ADR-0003 / docs/arsitektur-vendor.md §3.4 — FASE KONTRAKSI (F5). Setelah tidak ada kode yang membaca/menulis kolom lama, hapus
-- `vendors.category` / `country` / `contactInfo` dan jadikan `nameKey` / `countryCode` NOT NULL. Didahului PENGISIAN ULANG untuk vendor yang
-- masih dibuat jalur lama pada masa antara F1-F4 (kolom baru kosong). FAIL-CLOSED seperti F1: negara teks tak dikenal atau tabrakan
-- (nameKey, countryCode) membatalkan SELURUH migrasi (Prisma menjalankan skrip ini sebagai satu transaksi) — tak ada penebakan.

DO $$
DECLARE
  unknown_countries text;
  collisions text;
BEGIN
  -- 1. Negara: hanya baris yang belum punya kode ISO. Pemetaan eksplisit yang sama dengan F1.
  SELECT string_agg(DISTINCT '"' || country || '"', ', ') INTO unknown_countries
  FROM "vendors" WHERE "countryCode" IS NULL AND country NOT IN ('Saudi Arabia', 'Indonesia');
  IF unknown_countries IS NOT NULL THEN
    RAISE EXCEPTION 'Migrasi kontraksi vendor DIBATALKAN: nama negara tak dikenal pada vendors.country: %. Isi vendors.countryCode (kode ISO) secara manual lalu ulangi.', unknown_countries;
  END IF;

  -- 2. Kategori dan catatan untuk vendor ber-legacy (countryCode kosong): dilakukan SEBELUM countryCode diisi, karena itulah penanda barisnya.
  UPDATE "vendors" SET "notes" = concat_ws(E'\n', nullif(btrim("contactInfo"), ''), "notes")
    WHERE "countryCode" IS NULL AND nullif(btrim("contactInfo"), '') IS NOT NULL;
  UPDATE "vendors" SET "notes" = concat_ws(E'\n', "notes", 'Kategori lama: ' || category)
    WHERE "countryCode" IS NULL AND category IS NOT NULL AND category NOT IN ('syarikah', 'maskapai', 'hotel', 'transport', 'internal');

  INSERT INTO "_VendorToVendorCategory" ("A", "B")
  SELECT v.id, c.id
  FROM "vendors" v
  JOIN "vendor_categories" c ON c.slug = CASE v.category
    WHEN 'syarikah'  THEN 'visa'
    WHEN 'maskapai'  THEN 'airline'
    WHEN 'hotel'     THEN 'hotel'
    WHEN 'transport' THEN 'transport'
    WHEN 'internal'  THEN 'internal'
    ELSE 'other'
  END
  WHERE v."countryCode" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "_VendorToVendorCategory" p WHERE p."A" = v.id);

  -- 3. Tabrakan (nameKey, countryCode) DIPERIKSA DULU pada nilai yang akan terisi (indeks unik sudah ada sejak F1 — tanpa ini galatnya
  --    berupa pelanggaran indeks yang tak ramah). Tidak ada penggabungan diam-diam.
  SELECT string_agg('"' || k || '" (' || c || ') x' || n, ', ') INTO collisions
  FROM (
    SELECT coalesce("nameKey", lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) AS k,
           coalesce("countryCode", CASE country WHEN 'Saudi Arabia' THEN 'SA' WHEN 'Indonesia' THEN 'ID' END) AS c,
           count(*) AS n
    FROM "vendors" GROUP BY 1, 2 HAVING count(*) > 1
  ) d;
  IF collisions IS NOT NULL THEN
    RAISE EXCEPTION 'Migrasi kontraksi vendor DIBATALKAN: vendor ganda (nama sama di negara sama): %. Gabungkan/ubah nama secara manual lalu ulangi.', collisions;
  END IF;

  -- 4. Kode negara dan kunci nama.
  UPDATE "vendors" SET "countryCode" = CASE country WHEN 'Saudi Arabia' THEN 'SA' WHEN 'Indonesia' THEN 'ID' END
    WHERE "countryCode" IS NULL;
  UPDATE "vendors" SET "nameKey" = lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) WHERE "nameKey" IS NULL;
END $$;

ALTER TABLE "vendors" ALTER COLUMN "nameKey" SET NOT NULL,
ALTER COLUMN "countryCode" SET NOT NULL,
DROP COLUMN "category",
DROP COLUMN "country",
DROP COLUMN "contactInfo";
