-- Fase 9 (lanjutan): bentuk pembayaran manual vs gateway, akun kas gateway, batas aturan biaya.

-- Manual (gateway NULL): status pending|confirmed|rejected, tanpa kolom gateway. Gateway: awaiting|confirmed|expired, kanal wajib,
-- konfirmasi wajib membawa id transaksi gateway; tanpa kode unik (D9).
ALTER TABLE "payments" ADD CONSTRAINT "payments_gateway_shape" CHECK (
  ("gateway" IS NULL AND "status" IN ('pending', 'confirmed', 'rejected') AND "gatewayTrxId" IS NULL AND "channel" IS NULL AND "payCode" IS NULL
     AND "payExpiresAt" IS NULL AND "serviceFeeIdr" = 0 AND "gatewayFeeIdr" IS NULL) OR
  ("gateway" IS NOT NULL AND "status" IN ('awaiting', 'confirmed', 'expired') AND "channel" IS NOT NULL AND "uniqueCodeIdr" = 0
     AND "claimedAmountIdr" IS NOT NULL AND "claimedAmountIdr" > 0 AND ("status" <> 'confirmed' OR "gatewayTrxId" IS NOT NULL))
);
ALTER TABLE "payments" ADD CONSTRAINT "payments_gateway_fees" CHECK ("serviceFeeIdr" >= 0 AND ("gatewayFeeIdr" IS NULL OR "gatewayFeeIdr" >= 0));

-- Akun kas: gateway = systemKey 'gateway:<kode>'; kas tunai = 'cash:<kode>'.
ALTER TABLE "cash_accounts" DROP CONSTRAINT "cash_accounts_shape_check";
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_shape_check" CHECK (
  ("kind" = 'bank' AND "bankAccountId" IS NOT NULL AND "systemKey" IS NULL AND "qrisAccountId" IS NULL) OR
  ("kind" = 'cash' AND "bankAccountId" IS NULL AND "systemKey" LIKE 'cash:%' AND "qrisAccountId" IS NULL) OR
  ("kind" = 'qris' AND "bankAccountId" IS NULL AND "systemKey" IS NULL AND "qrisAccountId" IS NOT NULL) OR
  ("kind" = 'gateway' AND "bankAccountId" IS NULL AND "systemKey" LIKE 'gateway:%' AND "qrisAccountId" IS NULL)
);

ALTER TABLE "gateway_fee_rules" ADD CONSTRAINT "gateway_fee_rules_bounds" CHECK (
  "percent" BETWEEN 0 AND 100 AND "flatIdr" BETWEEN 0 AND 10000000 AND "channelGroup" ~ '^[a-z0-9_-]{1,40}$'
);
