-- Gudang identitas admin (docs/arsitektur-jamaah.md §4.4, Fase 8): alias kunci identitas yang digabung, cocok manual kartu,
-- penanda "periksa NIK", kanonik ditetapkan admin, jejak penghapusan identitas tanpa PII, dan pencarian nama trigram.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- AlterTable
ALTER TABLE "pilgrim_identities" ADD COLUMN     "canonicalPinnedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "saved_pilgrims" ADD COLUMN     "matchConfirmedAt" TIMESTAMPTZ(3),
ADD COLUMN     "matchConfirmedById" TEXT,
ADD COLUMN     "nikCheckRequestedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "pilgrim_identity_aliases" (
    "id" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok (timestamptz)

    CONSTRAINT "pilgrim_identity_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pilgrim_identity_erasures" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "reason" TEXT NOT NULL,
    "cardsDetached" INTEGER NOT NULL,
    "revealEvents" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok (timestamptz)

    CONSTRAINT "pilgrim_identity_erasures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pilgrim_identity_aliases_keyHash_key" ON "pilgrim_identity_aliases"("keyHash");

-- CreateIndex
CREATE INDEX "pilgrim_identity_aliases_identityId_idx" ON "pilgrim_identity_aliases"("identityId");

-- CreateIndex
CREATE INDEX "pilgrim_identity_aliases_createdById_idx" ON "pilgrim_identity_aliases"("createdById");

-- CreateIndex
CREATE INDEX "pilgrim_identity_erasures_actorId_idx" ON "pilgrim_identity_erasures"("actorId");

-- CreateIndex
CREATE INDEX "pilgrim_identities_nameKey_trgm_idx" ON "pilgrim_identities" USING GIN ("nameKey" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "saved_pilgrims_matchConfirmedById_idx" ON "saved_pilgrims"("matchConfirmedById");

-- AddForeignKey
ALTER TABLE "saved_pilgrims" ADD CONSTRAINT "saved_pilgrims_matchConfirmedById_fkey" FOREIGN KEY ("matchConfirmedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pilgrim_identity_aliases" ADD CONSTRAINT "pilgrim_identity_aliases_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "pilgrim_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pilgrim_identity_aliases" ADD CONSTRAINT "pilgrim_identity_aliases_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pilgrim_identity_erasures" ADD CONSTRAINT "pilgrim_identity_erasures_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Bentuk dijaga DB.
ALTER TABLE "pilgrim_identity_aliases" ADD CONSTRAINT "pilgrim_identity_aliases_kind" CHECK ("kind" IN ('nik', 'passport'));
ALTER TABLE "saved_pilgrims" ADD CONSTRAINT "saved_pilgrims_match_confirmed_by" CHECK ("matchConfirmedById" IS NULL OR "matchConfirmedAt" IS NOT NULL);
ALTER TABLE "pilgrim_identity_erasures" ADD CONSTRAINT "pilgrim_identity_erasures_cards" CHECK ("cardsDetached" >= 0 AND "revealEvents" >= 0);
ALTER TABLE "pilgrim_identity_erasures" ADD CONSTRAINT "pilgrim_identity_erasures_reason" CHECK ("reason" IN ('staff_erase', 'staff_detach'));
