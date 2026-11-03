-- Data jamaah tersimpan, Fase 2 (docs/arsitektur-jamaah.md §5, ADR-0005): gudang identitas global + kartu per akun + jejak identitas
-- + nilai cek kunci PII (SEC-168), dan FK booking_pilgrims.userId (drift D2).

-- Gagal-tertutup: FK userId baru tak boleh diam-diam menolak/mengosongkan data lama — hentikan bila ada userId yatim.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM "booking_pilgrims" bp WHERE bp."userId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = bp."userId");
  IF n > 0 THEN RAISE EXCEPTION 'booking_pilgrims: % baris userId tanpa akun — perbaiki dulu sebelum FK dipasang', n; END IF;
END $$;

-- CreateEnum
CREATE TYPE "gender" AS ENUM ('male', 'female');

-- CreateEnum
CREATE TYPE "pilgrim_match_status" AS ENUM ('matched', 'conflict', 'unmatched');

-- AlterTable
ALTER TABLE "booking_pilgrims" ADD COLUMN     "identityId" TEXT,
ADD COLUMN     "savedPilgrimId" TEXT;

-- CreateTable
CREATE TABLE "pilgrim_identities" (
    "id" TEXT NOT NULL,
    "nikHash" TEXT,
    "nikCipher" TEXT,
    "passportKeyHash" TEXT,
    "fullName" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "gender" "gender",
    "birthPlace" TEXT,
    "birthDate" DATE,
    "nationality" TEXT NOT NULL DEFAULT 'ID',
    "lastVerifiedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok (timestamptz)
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pilgrim_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_pilgrims" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "identityId" TEXT,
    "matchStatus" "pilgrim_match_status" NOT NULL DEFAULT 'unmatched',
    "selfOfUserId" TEXT,
    "fullName" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "nikHash" TEXT,
    "nikCipher" TEXT,
    "gender" "gender",
    "birthPlace" TEXT,
    "birthDate" DATE,
    "nationality" TEXT NOT NULL DEFAULT 'ID',
    "passportCipher" TEXT,
    "passportLast4" TEXT,
    "passportKeyHash" TEXT,
    "passportIssuedAt" DATE,
    "passportExpiry" DATE,
    "addressId" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "createdById" TEXT,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok (timestamptz)
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "saved_pilgrims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pilgrim_identity_events" (
    "id" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "actorId" TEXT,
    "kind" TEXT NOT NULL,
    "cardId" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok (timestamptz)

    CONSTRAINT "pilgrim_identity_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pii_key_checks" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok (timestamptz)

    CONSTRAINT "pii_key_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pilgrim_identities_nikHash_key" ON "pilgrim_identities"("nikHash");

-- CreateIndex
CREATE UNIQUE INDEX "pilgrim_identities_passportKeyHash_key" ON "pilgrim_identities"("passportKeyHash");

-- CreateIndex
CREATE INDEX "pilgrim_identities_nameKey_birthDate_idx" ON "pilgrim_identities"("nameKey", "birthDate");

-- CreateIndex
CREATE UNIQUE INDEX "saved_pilgrims_selfOfUserId_key" ON "saved_pilgrims"("selfOfUserId");

-- CreateIndex
CREATE UNIQUE INDEX "saved_pilgrims_addressId_key" ON "saved_pilgrims"("addressId");

-- CreateIndex
CREATE INDEX "saved_pilgrims_ownerId_archivedAt_nameKey_id_idx" ON "saved_pilgrims"("ownerId", "archivedAt", "nameKey", "id");

-- CreateIndex
CREATE INDEX "saved_pilgrims_identityId_idx" ON "saved_pilgrims"("identityId");

-- CreateIndex
CREATE INDEX "saved_pilgrims_matchStatus_createdAt_idx" ON "saved_pilgrims"("matchStatus", "createdAt");

-- CreateIndex
CREATE INDEX "saved_pilgrims_createdById_idx" ON "saved_pilgrims"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "saved_pilgrims_ownerId_nikHash_key" ON "saved_pilgrims"("ownerId", "nikHash");

-- CreateIndex
CREATE UNIQUE INDEX "saved_pilgrims_ownerId_passportKeyHash_key" ON "saved_pilgrims"("ownerId", "passportKeyHash");

-- CreateIndex
CREATE INDEX "pilgrim_identity_events_identityId_createdAt_idx" ON "pilgrim_identity_events"("identityId", "createdAt");

-- CreateIndex
CREATE INDEX "pilgrim_identity_events_actorId_idx" ON "pilgrim_identity_events"("actorId");

-- CreateIndex
CREATE INDEX "booking_pilgrims_userId_idx" ON "booking_pilgrims"("userId");

-- CreateIndex
CREATE INDEX "booking_pilgrims_savedPilgrimId_idx" ON "booking_pilgrims"("savedPilgrimId");

-- CreateIndex
CREATE INDEX "booking_pilgrims_identityId_idx" ON "booking_pilgrims"("identityId");

-- AddForeignKey
ALTER TABLE "booking_pilgrims" ADD CONSTRAINT "booking_pilgrims_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_pilgrims" ADD CONSTRAINT "booking_pilgrims_savedPilgrimId_fkey" FOREIGN KEY ("savedPilgrimId") REFERENCES "saved_pilgrims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_pilgrims" ADD CONSTRAINT "booking_pilgrims_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "pilgrim_identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_pilgrims" ADD CONSTRAINT "saved_pilgrims_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_pilgrims" ADD CONSTRAINT "saved_pilgrims_selfOfUserId_fkey" FOREIGN KEY ("selfOfUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_pilgrims" ADD CONSTRAINT "saved_pilgrims_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "pilgrim_identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_pilgrims" ADD CONSTRAINT "saved_pilgrims_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_pilgrims" ADD CONSTRAINT "saved_pilgrims_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pilgrim_identity_events" ADD CONSTRAINT "pilgrim_identity_events_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "pilgrim_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invarian yang tak bisa dinyatakan Prisma (dijaga juga oleh lib/pilgrims/service.ts):
-- identitas berkunci TEPAT SATU (NIK untuk WNI, negara+paspor untuk WNA); hash dan ciphertext selalu berpasangan.
ALTER TABLE "pilgrim_identities" ADD CONSTRAINT "pilgrim_identities_one_key_chk" CHECK (("nikHash" IS NOT NULL) <> ("passportKeyHash" IS NOT NULL));
ALTER TABLE "pilgrim_identities" ADD CONSTRAINT "pilgrim_identities_nik_pair_chk" CHECK (("nikHash" IS NULL) = ("nikCipher" IS NULL));
ALTER TABLE "saved_pilgrims" ADD CONSTRAINT "saved_pilgrims_nik_pair_chk" CHECK (("nikHash" IS NULL) = ("nikCipher" IS NULL));
ALTER TABLE "saved_pilgrims" ADD CONSTRAINT "saved_pilgrims_passport_set_chk" CHECK (("passportKeyHash" IS NULL) = ("passportCipher" IS NULL) AND ("passportCipher" IS NULL) = ("passportLast4" IS NULL));
-- Kartu "saya sendiri" hanya milik akun itu; tertaut (matched/conflict) ⇔ punya identitas.
ALTER TABLE "saved_pilgrims" ADD CONSTRAINT "saved_pilgrims_self_owner_chk" CHECK ("selfOfUserId" IS NULL OR "selfOfUserId" = "ownerId");
ALTER TABLE "saved_pilgrims" ADD CONSTRAINT "saved_pilgrims_match_identity_chk" CHECK (("matchStatus" = 'unmatched') = ("identityId" IS NULL));
