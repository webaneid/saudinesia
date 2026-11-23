-- Katalog Data Jamaah + saklar per produk (docs/arsitektur-data-jamaah.md §3–§4, fase D1).
-- Kolom katalog = SATU daftar global (menggantikan manifest_field_requirements per produk; tabel lama dikontraksi di D5).

ALTER TABLE "saved_pilgrims" ADD COLUMN "extraValues" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "saved_pilgrims" ADD CONSTRAINT "saved_pilgrims_extra_values_chk" CHECK (jsonb_typeof("extraValues") = 'object');

CREATE TABLE "pilgrim_fields" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "options" JSONB,
    "role" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok: kolom timestamptz
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "pilgrim_fields_pkey" PRIMARY KEY ("id"),
    -- Daftar = MANIFEST_FIELD_TYPES (lib/manifest/fieldDefs.ts) dan MANIFEST_ROLES (lib/manifest/roles.ts) — dijaga scripts/test-pilgrim-data.ts.
    CONSTRAINT "pilgrim_fields_type_chk" CHECK ("fieldType" IN ('text', 'textarea', 'phone', 'email', 'date', 'select', 'number', 'address')),
    CONSTRAINT "pilgrim_fields_role_chk" CHECK ("role" IS NULL OR "role" IN (
      'display_name', 'gender', 'birth_place', 'birth_date', 'nationality', 'passport_expiry', 'passport_issued',
      'phone', 'whatsapp', 'email', 'address', 'nik', 'passport_number')),
    -- Kolom berperan = kolom bawaan; nama lengkap selalu aktif dan wajib.
    CONSTRAINT "pilgrim_fields_system_role_chk" CHECK (("role" IS NOT NULL) = "isSystem"),
    CONSTRAINT "pilgrim_fields_name_chk" CHECK ("role" IS DISTINCT FROM 'display_name' OR ("isActive" AND "required")),
    CONSTRAINT "pilgrim_fields_key_chk" CHECK ("key" ~ '^[a-z][A-Za-z0-9]{0,63}$'),
    CONSTRAINT "pilgrim_fields_label_chk" CHECK (char_length(btrim("label")) BETWEEN 1 AND 100),
    CONSTRAINT "pilgrim_fields_options_chk" CHECK (("fieldType" = 'select') = ("options" IS NOT NULL AND jsonb_typeof("options") = 'array'))
);
CREATE UNIQUE INDEX "pilgrim_fields_key_key" ON "pilgrim_fields"("key");
CREATE UNIQUE INDEX "pilgrim_fields_role_key" ON "pilgrim_fields"("role");
CREATE INDEX "pilgrim_fields_isActive_order_idx" ON "pilgrim_fields"("isActive", "order");

CREATE TABLE "product_pilgrim_data" (
    "productType" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "product_pilgrim_data_pkey" PRIMARY KEY ("productType", "productId"),
    -- Daftar = PILGRIM_DATA_OWNERS (lib/pilgrim-data/owners.ts) — dijaga scripts/test-pilgrim-data.ts.
    CONSTRAINT "product_pilgrim_data_type_chk" CHECK ("productType" IN ('visa', 'package', 'haji', 'tour_package', 'hotel', 'transport', 'flight', 'catering', 'muthowif'))
);

-- Kolom bawaan = STANDARD_FIELDS (lib/manifest/fieldDefs.ts), kunci standar yang sama dengan fieldValues lama. Aktif = 9 kolom bawaan produk
-- visa hari ini; NIK, tempat lahir, tanggal terbit paspor, alamat tersedia tetapi nonaktif (diaktifkan pemilik di katalog).
INSERT INTO "pilgrim_fields" ("id", "key", "label", "fieldType", "options", "role", "required", "isSystem", "isActive", "order", "updatedAt") VALUES
  (gen_random_uuid()::text, 'fullName',         'Nama Lengkap',              'text',   NULL, 'display_name',    true,  true, true,  0,  now()), -- tz-ok: kolom timestamptz
  (gen_random_uuid()::text, 'gender',           'Jenis Kelamin',             'select', '[{"label":"Laki-laki","value":"male"},{"label":"Perempuan","value":"female"}]', 'gender', true, true, true, 1, now()), -- tz-ok: kolom timestamptz
  (gen_random_uuid()::text, 'email',            'Email',                     'email',  NULL, 'email',           false, true, true,  2,  now()), -- tz-ok: kolom timestamptz
  (gen_random_uuid()::text, 'phone',            'Nomor HP',                  'phone',  NULL, 'phone',           false, true, true,  3,  now()), -- tz-ok: kolom timestamptz
  (gen_random_uuid()::text, 'whatsapp',         'Nomor WhatsApp',            'phone',  NULL, 'whatsapp',        false, true, true,  4,  now()), -- tz-ok: kolom timestamptz
  (gen_random_uuid()::text, 'passportNumber',   'Nomor Paspor',              'text',   NULL, 'passport_number', false, true, true,  5,  now()), -- tz-ok: kolom timestamptz
  (gen_random_uuid()::text, 'passportExpiry',   'Tanggal Kadaluarsa Paspor', 'date',   NULL, 'passport_expiry', false, true, true,  6,  now()), -- tz-ok: kolom timestamptz
  (gen_random_uuid()::text, 'nationality',      'Kewarganegaraan',           'text',   NULL, 'nationality',     false, true, true,  7,  now()), -- tz-ok: kolom timestamptz
  (gen_random_uuid()::text, 'dateOfBirth',      'Tanggal Lahir',             'date',   NULL, 'birth_date',      false, true, true,  8,  now()), -- tz-ok: kolom timestamptz
  (gen_random_uuid()::text, 'nik',              'NIK',                       'text',   NULL, 'nik',             false, true, false, 9,  now()), -- tz-ok: kolom timestamptz
  (gen_random_uuid()::text, 'birthPlace',       'Tempat Lahir',              'text',   NULL, 'birth_place',     false, true, false, 10, now()), -- tz-ok: kolom timestamptz
  (gen_random_uuid()::text, 'passportIssuedAt', 'Tanggal Terbit Paspor',     'date',   NULL, 'passport_issued', false, true, false, 11, now()), -- tz-ok: kolom timestamptz
  (gen_random_uuid()::text, 'address',          'Alamat',                    'address', NULL, 'address',        false, true, false, 12, now()); -- tz-ok: kolom timestamptz

-- Fail-closed: kolom berperan di data lama dengan kunci BUKAN kunci standar tak bisa dipetakan ke katalog global (nilai lama akan tak terbaca).
-- Kolom bebas (tanpa peran) sengaja tidak dibawa (keputusan pemilik K1) — nilainya tetap di snapshot booking.
DO $$
DECLARE bad TEXT;
BEGIN
  SELECT string_agg(DISTINCT m."productType" || '/' || m."fieldKey" || '(' || m."role" || ')', ', ') INTO bad
  FROM "manifest_field_requirements" m
  LEFT JOIN "pilgrim_fields" f ON f."role" = m."role"
  WHERE m."role" IS NOT NULL AND (f."key" IS NULL OR f."key" <> m."fieldKey");
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Kolom berperan dengan kunci non-standar, tak bisa dipindah ke katalog: %', bad; END IF;
END $$;
