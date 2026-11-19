-- Force-majeure refund + kebijakan persetujuan (docs/rencana-force-majeure.md).
-- `isForceMajeure` tak pernah ditulis kode mana pun; fail-closed: berhenti bila ternyata ada baris bertanda (data tak boleh hilang diam-diam).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "refunds" WHERE "isForceMajeure") THEN
    RAISE EXCEPTION 'refunds.isForceMajeure = true ditemukan — petakan ke forceMajeureCategory secara manual dulu';
  END IF;
END $$;

CREATE TYPE "force_majeure_category" AS ENUM ('visa_rejected', 'medical', 'saudi_policy', 'other');
CREATE TYPE "refund_approval_mode" AS ENUM ('above_policy', 'above_half', 'either');

ALTER TABLE "refunds" DROP COLUMN "isForceMajeure";
ALTER TABLE "refunds" ADD COLUMN "forceMajeureCategory" "force_majeure_category";
-- Force-majeure hanya bermakna untuk refund pembatalan.
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_force_majeure_cancellation" CHECK ("forceMajeureCategory" IS NULL OR "source" = 'cancellation');

CREATE TABLE "refund_settings" (
    "id" VARCHAR(16) NOT NULL DEFAULT 'global',
    "approvalMode" "refund_approval_mode" NOT NULL DEFAULT 'above_policy',
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok: kolom timestamptz
    CONSTRAINT "refund_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refund_settings_single_row" CHECK ("id" = 'global')
);
INSERT INTO "refund_settings" ("id") VALUES ('global');
