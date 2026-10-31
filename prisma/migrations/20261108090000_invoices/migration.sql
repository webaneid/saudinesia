-- Booking Engine v2 Fase 6a (docs/arsitektur-booking-engine-v2.md §10.4): entitas invoice, satu per booking terbit.
-- Ditulis aplikasi HANYA oleh lib/invoice/issue.ts. Booking lama yang sudah terbit diberi invoice di sini (keputusan pemilik K6-b): nomor urut
-- menurut tanggal dibuat dengan pola/awalan/lebar dari invoice_settings, pajak 0 (tagihan tak berubah), kop & rekening = setelan saat migrasi.

CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "number" VARCHAR(80) NOT NULL,
    "sequenceKey" VARCHAR(8) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "linkVersion" INTEGER NOT NULL DEFAULT 1,
    "taxLines" JSONB NOT NULL DEFAULT '[]',
    "taxAddedIdr" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxIncludedIdr" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "companySnapshot" JSONB NOT NULL,
    "bankSnapshot" JSONB NOT NULL DEFAULT '[]',
    "termsDoc" TEXT,
    "footerNoteDoc" TEXT,
    "issuedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok (timestamptz)
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invoices_due_after_invoice" CHECK ("dueDate" >= "invoiceDate"),
    CONSTRAINT "invoices_revision_positive" CHECK ("revision" >= 1 AND "linkVersion" >= 1 AND "sequence" >= 1),
    CONSTRAINT "invoices_tax_nonnegative" CHECK ("taxAddedIdr" >= 0 AND "taxIncludedIdr" >= 0),
    CONSTRAINT "invoices_snapshots_shape" CHECK (jsonb_typeof("taxLines") = 'array' AND jsonb_typeof("bankSnapshot") = 'array' AND jsonb_typeof("companySnapshot") = 'object')
);

CREATE UNIQUE INDEX "invoices_bookingId_key" ON "invoices"("bookingId");
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");
CREATE UNIQUE INDEX "invoices_sequenceKey_sequence_key" ON "invoices"("sequenceKey", "sequence");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: satu invoice per booking non-draf.
WITH s AS (
  SELECT st.*,
    jsonb_build_object(
      'name', st."companyName", 'taxId', st."companyTaxId", 'phone', st."companyPhone", 'email', st."companyEmail", 'website', st."companyWebsite",
      'address', CASE
        WHEN a."id" IS NULL THEN NULL
        WHEN a."type" = 'domestic' THEN NULLIF(concat_ws(', ', NULLIF(a."fullAddress", ''), vi."name", di."name", re."name", pr."name", NULLIF(a."postalCode", '')), '')
        ELSE NULLIF(concat_ws(', ', NULLIF(a."fullAddress", ''), NULLIF(a."city", ''), NULLIF(a."stateRegion", ''), a."countryCode"), '')
      END
    ) AS company,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('bankName', ba."bankName", 'accountNumber', ba."accountNumber", 'accountHolder', ba."accountHolder", 'branch', ba."branch") ORDER BY ba."sortOrder", ba."id")
              FROM "bank_accounts" ba WHERE ba."isActive"), '[]'::jsonb) AS banks
  FROM "invoice_settings" st
  LEFT JOIN "addresses" a ON a."id" = st."companyAddressId"
  LEFT JOIN "address_villages" vi ON vi."id" = a."villageId"
  LEFT JOIN "address_districts" di ON di."id" = a."districtId"
  LEFT JOIN "address_regencies" re ON re."id" = a."regencyId"
  LEFT JOIN "address_provinces" pr ON pr."id" = a."provinceId"
  WHERE st."id" = 'global'
),
b AS (
  SELECT bk."id", bk."createdAt", bk."paymentDeadline",
         (bk."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE s."appTimezone") AS local_created,
         (bk."paymentDeadline" AT TIME ZONE 'UTC' AT TIME ZONE s."appTimezone")::date AS local_due
  FROM "bookings" bk CROSS JOIN s
  WHERE bk."status" <> 'draft'
),
k AS (
  SELECT b.*, CASE WHEN s."numberResetYearly" THEN to_char(b.local_created, 'YYYY') ELSE 'all' END AS seq_key
  FROM b CROSS JOIN s
),
n AS (
  SELECT k.*, row_number() OVER (PARTITION BY k.seq_key ORDER BY k."createdAt", k."id")::int AS seq FROM k
)
INSERT INTO "invoices" ("id", "bookingId", "number", "sequenceKey", "sequence", "issuedAt", "invoiceDate", "dueDate", "companySnapshot", "bankSnapshot", "termsDoc", "footerNoteDoc", "updatedAt")
SELECT gen_random_uuid()::text, n."id",
       replace(replace(replace(replace(replace(s."numberPattern",
         '{PREFIX}', s."numberPrefix"),
         '{YYYY}', to_char(n.local_created, 'YYYY')),
         '{YY}', to_char(n.local_created, 'YY')),
         '{MM}', to_char(n.local_created, 'MM')),
         '{SEQ}', CASE WHEN length(n.seq::text) >= s."numberPadding" THEN n.seq::text ELSE lpad(n.seq::text, s."numberPadding", '0') END),
       n.seq_key, n.seq,
       n."createdAt" AT TIME ZONE 'UTC',
       n.local_created::date,
       GREATEST(COALESCE(n.local_due, n.local_created::date), n.local_created::date),
       s.company, s.banks, s."termsDoc", s."footerNoteDoc",
       timezone('UTC', now())
FROM n CROSS JOIN s;

-- Penghitung diselaraskan ke nomor terakhir per kunci. Sebelum migrasi ini TIDAK ADA invoice yang pernah terbit (alokator belum punya pemanggil), jadi nilai
-- penghitung yang sudah ada (mis. sisa uji) adalah nomor hantu — dikembalikan ke 0 supaya invoice pertama bernomor 1, tanpa lompatan.
UPDATE "invoice_sequences" SET "lastNumber" = 0, "updatedAt" = timezone('UTC', now()) WHERE "key" NOT IN (SELECT DISTINCT "sequenceKey" FROM "invoices");
INSERT INTO "invoice_sequences" ("key", "lastNumber", "updatedAt")
SELECT "sequenceKey", max("sequence"), timezone('UTC', now()) FROM "invoices" GROUP BY "sequenceKey"
ON CONFLICT ("key") DO UPDATE SET "lastNumber" = EXCLUDED."lastNumber", "updatedAt" = EXCLUDED."updatedAt";

-- Fail-closed: setiap booking non-draf punya tepat satu invoice; urut tanpa lompat per kunci; penghitung = nomor terakhir.
DO $$
DECLARE missing int; gaps int; behind int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "invoice_settings" WHERE "id" = 'global') THEN
    RAISE EXCEPTION 'invoices: baris invoice_settings global tidak ada';
  END IF;
  SELECT count(*) INTO missing FROM "bookings" bk WHERE bk."status" <> 'draft' AND NOT EXISTS (SELECT 1 FROM "invoices" i WHERE i."bookingId" = bk."id");
  IF missing > 0 THEN RAISE EXCEPTION 'invoices: % booking terbit tanpa invoice', missing; END IF;
  SELECT count(*) INTO gaps FROM (SELECT "sequenceKey", count(*) c, max("sequence") m FROM "invoices" GROUP BY "sequenceKey") g WHERE g.c <> g.m;
  IF gaps > 0 THEN RAISE EXCEPTION 'invoices: urutan nomor berlubang di % kunci', gaps; END IF;
  SELECT count(*) INTO behind FROM (SELECT "sequenceKey", max("sequence") m FROM "invoices" GROUP BY "sequenceKey") g
    LEFT JOIN "invoice_sequences" q ON q."key" = g."sequenceKey" WHERE q."lastNumber" IS DISTINCT FROM g.m;
  IF behind > 0 THEN RAISE EXCEPTION 'invoices: penghitung tidak sama dengan nomor terakhir di % kunci', behind; END IF;
  IF EXISTS (SELECT 1 FROM "invoice_sequences" q WHERE q."lastNumber" <> 0 AND NOT EXISTS (SELECT 1 FROM "invoices" i WHERE i."sequenceKey" = q."key")) THEN
    RAISE EXCEPTION 'invoices: penghitung tanpa invoice tidak nol';
  END IF;
END $$;
