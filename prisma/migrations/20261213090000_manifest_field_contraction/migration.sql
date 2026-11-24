-- Kontraksi kolom data jamaah per produk (docs/arsitektur-data-jamaah.md §4 butir 5, fase D5; keputusan pemilik K1 & K3, 2026-11-24): katalog
-- `pilgrim_fields` + saklar `product_pilgrim_data` sudah menggantikannya, termasuk baris sentinel `core`. Nilai jamaah (`booking_pilgrims.fieldValues`)
-- TIDAK disentuh; yang hilang hanya definisi (label/tipe) per produk. Karena itu migrasi BERHENTI bila ada isian jamaah yang definisinya hanya ada di sini.
LOCK TABLE "manifest_field_requirements" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE bad TEXT;
BEGIN
  -- 1. Kolom berperan wajib terpetakan ke kunci katalog yang sama (diperiksa ulang: baris bisa berubah sejak 20261212090000_pilgrim_data_catalog).
  SELECT string_agg(DISTINCT m."productType" || '/' || m."fieldKey" || '(' || m."role" || ')', ', ') INTO bad
  FROM "manifest_field_requirements" m
  LEFT JOIN "pilgrim_fields" f ON f."role" = m."role"
  WHERE m."role" IS NOT NULL AND (f."key" IS NULL OR f."key" <> m."fieldKey");
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Kolom berperan dengan kunci non-standar, tak terpetakan ke katalog: %', bad; END IF;

  -- 2. Kolom yang SUDAH BERISI data jamaah harus punya padanan bertipe sama di katalog. Kosong = null, '' atau telepon tanpa nomor (isEmptyValue).
  --    Pengecualian hanya dua kolom yang diputuskan pemilik dihapus (K1: Nomor HP Host, Short Address; boleh bersufiks acak `_xxxxxx`).
  SELECT string_agg(DISTINCT m."fieldKey" || ' (' || m."label" || ', ' || m."fieldType" || ')', ', ') INTO bad
  FROM "manifest_field_requirements" m
  LEFT JOIN "pilgrim_fields" f ON f."key" = m."fieldKey"
  WHERE (f."key" IS NULL OR f."fieldType" <> m."fieldType")
    AND m."fieldKey" !~ '^(nomorHpHost|shortAddressUnwanWathoni)(_[0-9a-f]{6})?$'
    AND EXISTS (
      SELECT 1 FROM "booking_pilgrims" bp
      WHERE jsonb_typeof(bp."fieldValues") = 'object' AND bp."fieldValues" ? m."fieldKey"
        AND bp."fieldValues" -> m."fieldKey" NOT IN ('null'::jsonb, '""'::jsonb, '{}'::jsonb)
        AND NOT (jsonb_typeof(bp."fieldValues" -> m."fieldKey") = 'object' AND COALESCE(bp."fieldValues" -> m."fieldKey" ->> 'number', 'x') = '')
    );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Migrasi dibatalkan: kolom per produk ini berisi data jamaah tetapi tak punya padanan bertipe sama di Produk - Data Jamaah: %. Buat kolomnya (kunci dan tipe sama) di katalog dulu, atau minta keputusan pemilik.', bad;
  END IF;
END $$;

DROP TABLE "manifest_field_requirements";
