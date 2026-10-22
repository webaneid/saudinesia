-- Verifikasi WhatsApp lewat pesan masuk (ADR-0002, docs/arsitektur-whatsapp-verifikasi.md §3).
-- Nomor yang sudah ada TIDAK dianggap terverifikasi: WhatsApp berhenti sampai pemilik membuktikan nomornya (belum ada pengguna nyata).

-- AlterEnum
ALTER TYPE "AuthTokenType" ADD VALUE 'whatsapp_verification';

-- AlterTable
ALTER TABLE "users" ADD COLUMN "whatsappVerifiedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "verifiedWhatsapp" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_verifiedWhatsapp_key" ON "users"("verifiedWhatsapp");
