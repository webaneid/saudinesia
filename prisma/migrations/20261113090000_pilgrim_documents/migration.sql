-- CreateEnum
CREATE TYPE "document_review_status" AS ENUM ('pending', 'accepted', 'rejected');

-- CreateEnum
CREATE TYPE "document_reject_reason" AS ENUM ('not_matching', 'expired', 'unreadable', 'other');

-- CreateTable
CREATE TABLE "document_types" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "reusable" BOOLEAN NOT NULL,
    "icon" TEXT NOT NULL,
    "hasExpiry" BOOLEAN NOT NULL DEFAULT false,
    "minValidityMonths" INTEGER,
    "referenceLabel" TEXT,
    "referencePattern" TEXT,
    "allowMultiple" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok (timestamptz)
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "document_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pilgrim_documents" (
    "id" TEXT NOT NULL,
    "savedPilgrimId" TEXT NOT NULL,
    "documentTypeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "referenceCode" TEXT,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "issuedAt" DATE,
    "expiresAt" DATE,
    "status" "document_review_status" NOT NULL DEFAULT 'pending',
    "rejectReason" "document_reject_reason",
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok (timestamptz)

    CONSTRAINT "pilgrim_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_types_key_key" ON "document_types"("key");

-- CreateIndex
CREATE INDEX "document_types_isActive_order_idx" ON "document_types"("isActive", "order");

-- CreateIndex
CREATE UNIQUE INDEX "pilgrim_documents_objectKey_key" ON "pilgrim_documents"("objectKey");

-- CreateIndex
CREATE INDEX "pilgrim_documents_savedPilgrimId_documentTypeId_idx" ON "pilgrim_documents"("savedPilgrimId", "documentTypeId");

-- CreateIndex
CREATE INDEX "pilgrim_documents_documentTypeId_idx" ON "pilgrim_documents"("documentTypeId");

-- CreateIndex
CREATE INDEX "pilgrim_documents_status_createdAt_idx" ON "pilgrim_documents"("status", "createdAt");

-- CreateIndex
CREATE INDEX "pilgrim_documents_reviewedById_idx" ON "pilgrim_documents"("reviewedById");

-- CreateIndex
CREATE INDEX "pilgrim_documents_uploadedById_idx" ON "pilgrim_documents"("uploadedById");

-- AddForeignKey
ALTER TABLE "pilgrim_documents" ADD CONSTRAINT "pilgrim_documents_savedPilgrimId_fkey" FOREIGN KEY ("savedPilgrimId") REFERENCES "saved_pilgrims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pilgrim_documents" ADD CONSTRAINT "pilgrim_documents_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "document_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pilgrim_documents" ADD CONSTRAINT "pilgrim_documents_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pilgrim_documents" ADD CONSTRAINT "pilgrim_documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Invarian bentuk di DB (docs/arsitektur-jamaah.md §7.3) — penulis tunggal lib/documents/service.ts sudah menegakkannya; ini lapis terakhir.
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_key_chk" CHECK ("key" ~ '^[a-z][a-z0-9_]{1,39}$');
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_validity_chk" CHECK ("minValidityMonths" IS NULL OR ("hasExpiry" AND "minValidityMonths" BETWEEN 1 AND 120));
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_reference_chk" CHECK ("referencePattern" IS NULL OR "referenceLabel" IS NOT NULL);
ALTER TABLE "pilgrim_documents" ADD CONSTRAINT "pilgrim_documents_mime_chk" CHECK ("mimeType" IN ('image/webp', 'application/pdf'));
ALTER TABLE "pilgrim_documents" ADD CONSTRAINT "pilgrim_documents_size_chk" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 5242880);
ALTER TABLE "pilgrim_documents" ADD CONSTRAINT "pilgrim_documents_sha256_chk" CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "pilgrim_documents" ADD CONSTRAINT "pilgrim_documents_key_chk" CHECK ("objectKey" LIKE 'saved-pilgrims/%');
ALTER TABLE "pilgrim_documents" ADD CONSTRAINT "pilgrim_documents_reject_chk" CHECK (("status" = 'rejected') = ("rejectReason" IS NOT NULL));
ALTER TABLE "pilgrim_documents" ADD CONSTRAINT "pilgrim_documents_dates_chk" CHECK ("issuedAt" IS NULL OR "expiresAt" IS NULL OR "issuedAt" < "expiresAt");

-- Katalog bawaan (§7.1). Label publik — istilah internal (BRN) tidak dipakai (K7). Bawaan hanya bisa dinonaktifkan, tidak dihapus.
INSERT INTO "document_types" ("id", "key", "label", "reusable", "icon", "hasExpiry", "minValidityMonths", "referenceLabel", "referencePattern", "allowMultiple", "isSystem", "order", "updatedAt") VALUES
  (gen_random_uuid()::text, 'passport',              'Foto Paspor',                          true,  'BookOpen', true,  6,    NULL,                  NULL,             false, true, 10, now()), -- tz-ok (timestamptz)
  (gen_random_uuid()::text, 'ktp',                   'Foto KTP',                             true,  'IdCard',   false, NULL, NULL,                  NULL,             false, true, 20, now()), -- tz-ok (timestamptz)
  (gen_random_uuid()::text, 'kk',                    'Kartu Keluarga',                       true,  'Users',    false, NULL, NULL,                  NULL,             false, true, 30, now()), -- tz-ok (timestamptz)
  (gen_random_uuid()::text, 'vaccine',               'Sertifikat Vaksin',                    true,  'Syringe',  true,  NULL, NULL,                  NULL,             false, true, 40, now()), -- tz-ok (timestamptz)
  (gen_random_uuid()::text, 'flight_ticket',         'Tiket Pesawat Pulang-Pergi',           false, 'Plane',    false, NULL, 'Kode Booking (PNR)',  '^[A-Z0-9]{6}$',  true,  true, 50, now()), -- tz-ok (timestamptz)
  (gen_random_uuid()::text, 'hotel_reservation',     'Bukti Reservasi Hotel Makkah/Madinah', false, 'Hotel',    false, NULL, NULL,                  NULL,             true,  true, 60, now()), -- tz-ok (timestamptz)
  (gen_random_uuid()::text, 'transport_reservation', 'Bukti Reservasi Transportasi',         false, 'Bus',      false, NULL, NULL,                  NULL,             false, true, 70, now()), -- tz-ok (timestamptz)
  (gen_random_uuid()::text, 'other',                 'Dokumen Lain',                         true,  'FileText', false, NULL, NULL,                  NULL,             true,  true, 80, now()); -- tz-ok (timestamptz)
