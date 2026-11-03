-- Visa V3 (docs/rencana-visa-produk.md §2.5): daftar centang "wajib dibeli bersama visa ini" + pelonggaran per pelanggan dihapus.
-- • visa_products.requiredComponents: jenis `hotel` (kota apa saja) → `hotel_makkah` + `hotel_madinah`; jenis tak dikenal → migrasi BERHENTI (fail-closed)
-- • users.allowVisaWithoutBundle DIHAPUS — aturan visa sepenuhnya dari produk; masih ada pelanggan berpelonggaran aktif → migrasi BERHENTI (tinjau manual dulu)

-- 1. Aturan visa
DO $$
DECLARE bad INT;
BEGIN
  SELECT count(*) INTO bad FROM "visa_products" v
  -- CASE, bukan OR: Postgres tak menjamin urutan evaluasi OR, dan jsonb_array_elements atas non-array melempar galat tanpa pesan yang jelas.
  WHERE CASE WHEN v."requiredComponents" IS NULL OR jsonb_typeof(v."requiredComponents") <> 'array' THEN true
    ELSE EXISTS (
      SELECT 1 FROM jsonb_array_elements(v."requiredComponents") e
      WHERE NOT (jsonb_typeof(e) = 'object'
        AND e ->> 'type' IN ('flight', 'hotel', 'hotel_makkah', 'hotel_madinah', 'transport', 'muthowif', 'tour', 'catering'))
    ) END;
  IF bad > 0 THEN
    RAISE EXCEPTION 'visa_required_components_v3: % produk visa memiliki requiredComponents tak dikenal — tinjau manual sebelum migrasi', bad;
  END IF;
END $$;

UPDATE "visa_products" v SET "requiredComponents" = (
  SELECT COALESCE(jsonb_agg(DISTINCT x), '[]'::jsonb)
  FROM jsonb_array_elements(v."requiredComponents") e,
  LATERAL jsonb_array_elements(CASE WHEN e ->> 'type' = 'hotel'
    THEN jsonb_build_array(jsonb_build_object('type', 'hotel_makkah'), jsonb_build_object('type', 'hotel_madinah'))
    ELSE jsonb_build_array(e) END) x
)
WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v."requiredComponents") e WHERE e ->> 'type' = 'hotel');

-- 2. Pelonggaran per pelanggan
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM "users" WHERE "allowVisaWithoutBundle";
  IF n > 0 THEN
    RAISE EXCEPTION 'visa_required_components_v3: % pelanggan masih memakai pelonggaran aturan visa — jual produk Visa only atau matikan pelonggarannya dulu', n;
  END IF;
END $$;

ALTER TABLE "users" DROP COLUMN "allowVisaWithoutBundle";
