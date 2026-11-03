-- Data jamaah Fase 7a (docs/arsitektur-jamaah.md §5.3): kartu jamaah tersimpan ditautkan ke jamaah booking.
-- 1) Model `Document` lama DIHAPUS — fail-closed: berhenti bila masih ada baris (berkas nyata tak boleh hilang diam-diam).
-- 2) Snapshot NIK/paspor jamaah booking disegel (kolom cipher + indeks baris yang sama, pola saved_pilgrims).
-- 3) Dokumen per perjalanan: pilgrim_documents.bookingId.
-- 4) Peran field manifest = daftar tunggal (lib/manifest/roles.ts); field seed yang dikenal diberi peran baku.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "documents") THEN
    RAISE EXCEPTION 'Tabel documents masih berisi baris — pindahkan berkas ke dokumen jamaah tersimpan sebelum migrasi ini';
  END IF;
END $$;

DROP TABLE "documents";

ALTER TABLE "booking_pilgrims"
  ADD COLUMN "nikHash" TEXT,
  ADD COLUMN "nikCipher" TEXT,
  ADD COLUMN "passportCountry" TEXT,
  ADD COLUMN "passportKeyHash" TEXT,
  ADD COLUMN "passportCipher" TEXT,
  ADD COLUMN "passportLast4" TEXT;
ALTER TABLE "booking_pilgrims" ADD CONSTRAINT "booking_pilgrims_nik_pair_chk" CHECK (("nikHash" IS NULL) = ("nikCipher" IS NULL));
ALTER TABLE "booking_pilgrims" ADD CONSTRAINT "booking_pilgrims_passport_set_chk" CHECK (
  ("passportKeyHash" IS NULL) = ("passportCipher" IS NULL)
  AND ("passportCipher" IS NULL) = ("passportLast4" IS NULL)
  AND ("passportCipher" IS NULL) = ("passportCountry" IS NULL));
ALTER TABLE "booking_pilgrims" ADD CONSTRAINT "booking_pilgrims_passport_country_chk" CHECK ("passportCountry" IS NULL OR "passportCountry" ~ '^[A-Z]{2}$');

ALTER TABLE "pilgrim_documents" ADD COLUMN "bookingId" TEXT;
ALTER TABLE "pilgrim_documents" ADD CONSTRAINT "pilgrim_documents_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "pilgrim_documents_bookingId_savedPilgrimId_idx" ON "pilgrim_documents"("bookingId", "savedPilgrimId");
-- Satu kartu paling banyak satu jamaah per booking (NULL saling berbeda di Postgres → jamaah tanpa kartu tak bentrok).
CREATE UNIQUE INDEX "booking_pilgrims_bookingId_savedPilgrimId_key" ON "booking_pilgrims"("bookingId", "savedPilgrimId");

-- Peran baku untuk field seed yang dikenal (hanya yang belum berperan).
UPDATE "manifest_field_requirements" SET "role" = CASE "fieldKey"
    WHEN 'gender' THEN 'gender'
    WHEN 'dateOfBirth' THEN 'birth_date'
    WHEN 'birthDate' THEN 'birth_date'
    WHEN 'placeOfBirth' THEN 'birth_place'
    WHEN 'birthPlace' THEN 'birth_place'
    WHEN 'nationality' THEN 'nationality'
    WHEN 'passportExpiry' THEN 'passport_expiry'
    WHEN 'passportIssued' THEN 'passport_issued'
    WHEN 'nik' THEN 'nik'
    WHEN 'passportNumber' THEN 'passport_number'
  END
WHERE "role" IS NULL AND "fieldKey" IN ('gender', 'dateOfBirth', 'birthDate', 'placeOfBirth', 'birthPlace', 'nationality', 'passportExpiry', 'passportIssued', 'nik', 'passportNumber');

-- Fail-closed: field yang kini berperan rahasia (`nik`/`passport_number`) tak boleh sudah berisi nilai polos di snapshot jamaah booking —
-- SQL tak bisa menyegel (kunci ada di aplikasi), jadi berhenti alih-alih membiarkan NIK/paspor polos atau menghapusnya diam-diam.
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM "booking_pilgrims" bp
  JOIN "manifest_field_requirements" f ON f."role" IN ('nik', 'passport_number') AND (
    (f."productType" = 'visa' AND f."productId" = (SELECT va."visaProductId" FROM "visa_applications" va WHERE va."bookingPilgrimId" = bp."id"))
    OR (f."productType" = 'core' AND NOT EXISTS (SELECT 1 FROM "visa_applications" va WHERE va."bookingPilgrimId" = bp."id")))
  WHERE COALESCE(bp."fieldValues" ->> f."fieldKey", '') <> '';
  IF n > 0 THEN
    RAISE EXCEPTION 'Ada % nilai NIK/nomor paspor polos di booking_pilgrims.fieldValues — segel lewat aplikasi sebelum migrasi ini', n;
  END IF;
END $$;

DO $$
DECLARE bad TEXT;
BEGIN
  SELECT string_agg(DISTINCT "role", ', ') INTO bad FROM "manifest_field_requirements"
  WHERE "role" IS NOT NULL AND "role" NOT IN ('display_name', 'gender', 'birth_place', 'birth_date', 'nationality', 'passport_expiry', 'passport_issued',
                                              'phone', 'whatsapp', 'email', 'address', 'nik', 'passport_number');
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Peran field manifest tak dikenal: %', bad; END IF;
  SELECT string_agg("productType" || ':' || "productId" || ':' || "role", ', ') INTO bad FROM (
    SELECT "productType", "productId", "role" FROM "manifest_field_requirements" WHERE "role" IS NOT NULL
    GROUP BY 1, 2, 3 HAVING count(*) > 1) d;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Satu peran dipakai dua field dalam satu produk: %', bad; END IF;
END $$;

ALTER TABLE "manifest_field_requirements" ADD CONSTRAINT "manifest_field_requirements_role_chk" CHECK ("role" IS NULL OR "role" IN (
  'display_name', 'gender', 'birth_place', 'birth_date', 'nationality', 'passport_expiry', 'passport_issued',
  'phone', 'whatsapp', 'email', 'address', 'nik', 'passport_number'));
CREATE UNIQUE INDEX "manifest_field_requirements_role_key" ON "manifest_field_requirements"("productType", "productId", "role");
