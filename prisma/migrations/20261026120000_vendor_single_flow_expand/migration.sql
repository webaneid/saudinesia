-- ADR-0003 / docs/arsitektur-vendor.md §3.4 — FASE EKSPANSI (F1). Menambah struktur vendor tunggal dan memigrasikan data; kolom LEGACY
-- (category, country, contactInfo) SENGAJA masih ada dan dihapus oleh migrasi kontraksi di F5. FAIL-CLOSED: nama negara tak dikenal,
-- tabrakan (nameKey, countryCode), atau vendor pilihan yatim membatalkan SELURUH migrasi (Prisma menjalankan skrip ini sebagai satu transaksi).

-- ── 1. Struktur baru (tanpa unik/FK dulu: data dimigrasikan lebih dulu) ──────────────────────────────────────────────────
ALTER TABLE "vendors" ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "countryCode" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "nameKey" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "phoneCountryCode" TEXT,
ADD COLUMN     "systemKey" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "website" TEXT,
ADD COLUMN     "whatsapp" TEXT,
ADD COLUMN     "whatsappCountryCode" TEXT;

CREATE TABLE "vendor_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "_VendorToVendorCategory" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_VendorToVendorCategory_AB_pkey" PRIMARY KEY ("A","B")
);

CREATE UNIQUE INDEX "vendor_categories_slug_key" ON "vendor_categories"("slug");
CREATE INDEX "_VendorToVendorCategory_B_index" ON "_VendorToVendorCategory"("B");
ALTER TABLE "_VendorToVendorCategory" ADD CONSTRAINT "_VendorToVendorCategory_A_fkey" FOREIGN KEY ("A") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_VendorToVendorCategory" ADD CONSTRAINT "_VendorToVendorCategory_B_fkey" FOREIGN KEY ("B") REFERENCES "vendor_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 2. Kategori sistem (slug stabil — dipakai kode sebagai konteks picker; lib/constants/vendor.ts harus sama) ───────────
INSERT INTO "vendor_categories" ("id", "name", "slug", "sortOrder", "isSystem") VALUES
  (gen_random_uuid()::text, 'Hotel',                 'hotel',         10, true),
  (gen_random_uuid()::text, 'Transportasi / Bus',    'transport',     20, true),
  (gen_random_uuid()::text, 'Maskapai',              'airline',       30, true),
  (gen_random_uuid()::text, 'Visa / Syarikah',       'visa',          40, true),
  (gen_random_uuid()::text, 'Katering',              'catering',      50, true),
  (gen_random_uuid()::text, 'Muthowif / Pemandu',    'guide',         60, true),
  (gen_random_uuid()::text, 'Operator Tur / Ziarah', 'tour-operator', 70, true),
  (gen_random_uuid()::text, 'Internal',              'internal',      80, true),
  (gen_random_uuid()::text, 'Lainnya',               'other',         90, true);

-- ── 3. Migrasi data vendor ───────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  unknown_countries text;
  collisions text;
BEGIN
  -- 3a. Negara teks → kode ISO. Pemetaan EKSPLISIT; nilai tak dikenal membatalkan migrasi (bukan tebakan).
  SELECT string_agg(DISTINCT '"' || country || '"', ', ') INTO unknown_countries
  FROM "vendors" WHERE country NOT IN ('Saudi Arabia', 'Indonesia');
  IF unknown_countries IS NOT NULL THEN
    RAISE EXCEPTION 'Migrasi vendor DIBATALKAN: nama negara tak dikenal pada vendors.country: %. Tambahkan pemetaan eksplisit ke migrasi (atau perbaiki datanya) lalu ulangi.', unknown_countries;
  END IF;

  UPDATE "vendors" SET
    "countryCode" = CASE country WHEN 'Saudi Arabia' THEN 'SA' WHEN 'Indonesia' THEN 'ID' END,
    "nameKey"     = lower(regexp_replace(btrim(name), '\s+', ' ', 'g'));

  -- 3b. Tabrakan (nameKey, countryCode) membatalkan migrasi — tidak ada penggabungan diam-diam.
  SELECT string_agg('"' || "nameKey" || '" (' || "countryCode" || ') x' || n, ', ') INTO collisions
  FROM (SELECT "nameKey", "countryCode", count(*) AS n FROM "vendors" GROUP BY "nameKey", "countryCode" HAVING count(*) > 1) d;
  IF collisions IS NOT NULL THEN
    RAISE EXCEPTION 'Migrasi vendor DIBATALKAN: vendor ganda (nama sama di negara sama): %. Gabungkan/ubah nama secara manual lalu ulangi.', collisions;
  END IF;

  -- 3c. contactInfo → notes; kategori lama yang BUKAN jenis vendor (label modul / tak dikenal) dicatat di notes agar admin bisa meninjau.
  UPDATE "vendors" SET "notes" = nullif(btrim("contactInfo"), '');
  UPDATE "vendors"
    SET "notes" = concat_ws(E'\n', "notes", 'Kategori lama: ' || category)
    WHERE category IS NOT NULL AND category NOT IN ('syarikah', 'maskapai', 'hotel', 'transport', 'internal');

  -- 3d. Kategori lama → kategori baku (many-to-many). package/tour_package/haji/null/lain → 'other' untuk ditinjau admin.
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
  END;

  -- 3e. Vendor sistem 'Saudinesia' (internal, Muthowif): tandai yang sudah ada, atau buat bila belum ada.
  UPDATE "vendors" SET "systemKey" = 'saudinesia'
  WHERE id = (SELECT id FROM "vendors" WHERE category = 'internal' AND "nameKey" = 'saudinesia' ORDER BY "createdAt" LIMIT 1);

  IF NOT EXISTS (SELECT 1 FROM "vendors" WHERE "systemKey" = 'saudinesia') THEN
    IF EXISTS (SELECT 1 FROM "vendors" WHERE "nameKey" = 'saudinesia' AND "countryCode" = 'ID') THEN
      RAISE EXCEPTION 'Migrasi vendor DIBATALKAN: sudah ada vendor "Saudinesia" (ID) yang bukan kategori internal; ubah namanya atau kategorinya lebih dulu.';
    END IF;
    WITH ins AS (
      INSERT INTO "vendors" ("id", "name", "category", "country", "nameKey", "countryCode", "systemKey", "isActive")
      VALUES (gen_random_uuid()::text, 'Saudinesia', 'internal', 'Indonesia', 'saudinesia', 'ID', 'saudinesia', true)
      RETURNING id
    )
    INSERT INTO "_VendorToVendorCategory" ("A", "B")
    SELECT ins.id, c.id FROM ins, "vendor_categories" c WHERE c.slug = 'internal';
  END IF;

  -- 3f. Vendor pilihan yatim (tanpa vendor) membatalkan migrasi sebelum FK dipasang.
  IF EXISTS (SELECT 1 FROM "preferred_vendors" pv LEFT JOIN "vendors" v ON v.id = pv."vendorId" WHERE v.id IS NULL) THEN
    RAISE EXCEPTION 'Migrasi vendor DIBATALKAN: preferred_vendors merujuk vendor yang tidak ada (yatim). Perbaiki datanya lebih dulu.';
  END IF;
END $$;

-- ── 4. Keunikan dan FK (setelah data bersih) ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "vendors_systemKey_key" ON "vendors"("systemKey");
CREATE UNIQUE INDEX "vendors_nameKey_countryCode_key" ON "vendors"("nameKey", "countryCode");
ALTER TABLE "preferred_vendors" ADD CONSTRAINT "preferred_vendors_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
