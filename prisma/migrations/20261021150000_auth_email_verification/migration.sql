-- Auth berbasis email tanpa OTP WhatsApp (docs/arsitektur-auth.md, ADR-0001).
-- Aplikasi belum produksi: tabel OTP dan kolom reset lama dibuang tanpa migrasi data.

-- CreateEnum
CREATE TYPE "AuthTokenType" AS ENUM ('registration', 'password_reset');

-- AlterEnum
ALTER TYPE "ConsentType" ADD VALUE 'whatsapp_notifications';

-- Email dinormalisasi huruf kecil di semua jalur; samakan data yang ada
-- (gagal dengan jelas bila ada dua akun yang hanya beda huruf besar/kecil — selesaikan manual).
UPDATE "users" SET "email" = lower("email") WHERE "email" <> lower("email");

-- AlterTable users
ALTER TABLE "users" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "whatsapp" TEXT;
-- Akun yang sudah aktif (lolos OTP WA, atau dibuat superadmin) dianggap terverifikasi; belum ada pengguna nyata.
UPDATE "users" SET "emailVerifiedAt" = now() WHERE "isActive" = true;
-- Nomor lama sudah terverifikasi → pakai juga sebagai WhatsApp bila ada
UPDATE "users" SET "whatsapp" = "phone" WHERE "phone" IS NOT NULL;
ALTER TABLE "users" ALTER COLUMN "isActive" SET DEFAULT true;
DROP INDEX "users_phone_key";
DROP INDEX "users_resetToken_key";
ALTER TABLE "users" DROP COLUMN "phoneVerifiedAt";
ALTER TABLE "users" DROP COLUMN "resetToken";
ALTER TABLE "users" DROP COLUMN "resetTokenExp";

-- DropTable
DROP TABLE "otp_requests";

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" TEXT NOT NULL,
    "type" "AuthTokenType" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT,
    "payload" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_tokens_tokenHash_key" ON "auth_tokens"("tokenHash");
CREATE INDEX "auth_tokens_userId_type_idx" ON "auth_tokens"("userId", "type");
CREATE INDEX "auth_tokens_email_type_idx" ON "auth_tokens"("email", "type");

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
