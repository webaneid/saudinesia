-- Fase 5 data jamaah (docs/arsitektur-jamaah.md §7.6): syarat dokumen per produk merujuk katalog `document_types`, bukan teks bebas;
-- `visa_products.requirements` (Json dual-write lama) dihapus. FAIL-CLOSED: berhenti bila ada data yang tak bisa dipetakan utuh.

-- 1. Json lama harus sudah tercermin di `document_requirements` (dual-write) — kalau tidak, menghapus kolom akan menghilangkan syarat.
DO $$
DECLARE missing TEXT;
BEGIN
  SELECT string_agg(v."id" || ':' || (e->>'docType'), ', ') INTO missing
  FROM "visa_products" v, jsonb_array_elements(CASE WHEN jsonb_typeof(v."requirements") = 'array' THEN v."requirements" ELSE '[]'::jsonb END) e
  WHERE NOT EXISTS (
    SELECT 1 FROM "document_requirements" r WHERE r."productType" = 'visa' AND r."productId" = v."id" AND r."docType" = e->>'docType'
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'visa_products.requirements memuat syarat tanpa baris document_requirements: %', missing;
  END IF;
END $$;

-- 2. Petakan kunci teks lama ke katalog.
ALTER TABLE "document_requirements" ADD COLUMN "documentTypeId" TEXT;
UPDATE "document_requirements" r SET "documentTypeId" = t."id"
FROM "document_types" t
WHERE t."key" = CASE lower(trim(r."docType"))
  WHEN 'passport' THEN 'passport' WHEN 'paspor' THEN 'passport'
  WHEN 'ktp' THEN 'ktp'
  WHEN 'kk' THEN 'kk' WHEN 'kartu_keluarga' THEN 'kk'
  WHEN 'evaksin' THEN 'vaccine' WHEN 'vaksin' THEN 'vaccine' WHEN 'vaccine' THEN 'vaccine'
  WHEN 'etiket' THEN 'flight_ticket' WHEN 'flight_ticket' THEN 'flight_ticket'
  ELSE NULL END;

DO $$
DECLARE unknown TEXT; dup TEXT;
BEGIN
  SELECT string_agg(DISTINCT "docType", ', ') INTO unknown FROM "document_requirements" WHERE "documentTypeId" IS NULL;
  IF unknown IS NOT NULL THEN
    RAISE EXCEPTION 'document_requirements.docType tak dikenal katalog (petakan dulu atau tambah jenis dokumen): %', unknown;
  END IF;
  SELECT string_agg("productType" || ':' || "productId", ', ') INTO dup FROM (
    SELECT "productType", "productId" FROM "document_requirements" GROUP BY "productType", "productId", "documentTypeId" HAVING count(*) > 1
  ) d;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'document_requirements ganda sesudah pemetaan ke katalog: %', dup;
  END IF;
END $$;

-- 3. Bentuk akhir.
DROP INDEX "document_requirements_productType_productId_idx";
ALTER TABLE "document_requirements" DROP COLUMN "docType",
  ALTER COLUMN "documentTypeId" SET NOT NULL,
  ALTER COLUMN "label" DROP NOT NULL;
ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_label_check" CHECK ("label" IS NULL OR char_length("label") BETWEEN 2 AND 80),
  ADD CONSTRAINT "document_requirements_description_check" CHECK (char_length("description") <= 300);
ALTER TABLE "visa_products" DROP COLUMN "requirements";

CREATE INDEX "document_requirements_documentTypeId_idx" ON "document_requirements"("documentTypeId");
CREATE UNIQUE INDEX "document_requirements_productType_productId_documentTypeId_key" ON "document_requirements"("productType", "productId", "documentTypeId");
ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "document_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
