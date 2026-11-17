-- Fase 9 iPaymu (docs/arsitektur-booking-engine-v2.md §10.12): kolom gateway di payments, status awaiting/expired, akun kas gateway,
-- komponen kas biaya_layanan/mdr, aturan biaya per kelompok kanal (K9-2). CHECK yang memakai nilai enum baru ada di migrasi berikutnya
-- (nilai enum baru belum boleh dipakai di transaksi yang menambahkannya).

-- Fail-closed: kolom biaya lama di invoice_settings belum pernah dipakai kode mana pun (disembunyikan sejak 7a). Bila ada nilai ≠ 0,
-- berhenti — pindahkan dulu ke gateway_fee_rules secara sadar, jangan dibuang diam-diam.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "invoice_settings" WHERE "ipaymuFeePercent" <> 0 OR "ipaymuFeeFlatIdr" <> 0 OR "xenditFeePercent" <> 0 OR "xenditFeeFlatIdr" <> 0) THEN
    RAISE EXCEPTION 'invoice_settings punya biaya gateway lama yang belum dipindahkan ke gateway_fee_rules';
  END IF;
END $$;

ALTER TABLE "invoice_settings" DROP CONSTRAINT "invoice_settings_fees";

-- CreateEnum
CREATE TYPE "payment_gateway" AS ENUM ('ipaymu', 'xendit');

-- AlterEnum
ALTER TYPE "cash_account_kind" ADD VALUE 'gateway';

-- AlterEnum
ALTER TYPE "cash_component" ADD VALUE 'biaya_layanan';
ALTER TYPE "cash_component" ADD VALUE 'mdr';

-- AlterEnum
ALTER TYPE "payment_status" ADD VALUE 'awaiting';
ALTER TYPE "payment_status" ADD VALUE 'expired';

-- AlterTable
ALTER TABLE "invoice_settings" DROP COLUMN "ipaymuFeeFlatIdr",
DROP COLUMN "ipaymuFeePercent",
DROP COLUMN "xenditFeeFlatIdr",
DROP COLUMN "xenditFeePercent";

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "channel" VARCHAR(80),
ADD COLUMN     "channelName" VARCHAR(120),
ADD COLUMN     "gateway" "payment_gateway",
ADD COLUMN     "gatewayCheckedAt" TIMESTAMPTZ(3),
ADD COLUMN     "gatewayFeeIdr" DECIMAL(14,2),
ADD COLUMN     "gatewayTrxId" VARCHAR(80),
ADD COLUMN     "payCode" TEXT,
ADD COLUMN     "payExpiresAt" TIMESTAMPTZ(3),
ADD COLUMN     "serviceFeeIdr" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "gateway_fee_rules" (
    "id" TEXT NOT NULL,
    "gateway" "payment_gateway" NOT NULL,
    "channelGroup" VARCHAR(40) NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "flatIdr" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok (timestamptz)
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "gateway_fee_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gateway_fee_rules_gateway_channelGroup_key" ON "gateway_fee_rules"("gateway", "channelGroup");

-- CreateIndex
CREATE UNIQUE INDEX "payments_gatewayTrxId_key" ON "payments"("gatewayTrxId");

-- CreateIndex
CREATE INDEX "payments_status_gateway_idx" ON "payments"("status", "gateway");

