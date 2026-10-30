-- Pengaturan Invoice (docs/arsitektur-booking-engine-v2.md §6, Fase 2): InvoiceSettings (satu baris 'global'), BankAccount, QrisAccount, TaxRule, InvoiceSequence.
-- Aditif (tabel baru), tanpa data lama yang tersentuh. Kolom waktu = timestamptz.

-- CreateEnum
CREATE TYPE "tax_mode" AS ENUM ('added', 'included');

-- CreateTable
CREATE TABLE "invoice_settings" (
    "id" TEXT NOT NULL,
    "numberPrefix" VARCHAR(12) NOT NULL DEFAULT 'INV',
    "numberPattern" VARCHAR(60) NOT NULL DEFAULT '{PREFIX}-{YYYY}-{SEQ}',
    "numberPadding" INTEGER NOT NULL DEFAULT 4,
    "numberResetYearly" BOOLEAN NOT NULL DEFAULT true,
    "appTimezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Jakarta',
    "defaultDueDays" INTEGER NOT NULL DEFAULT 4,
    "expireDaysBeforeReference" INTEGER NOT NULL DEFAULT 7,
    "minimumFirstPaymentPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "uniqueCodeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "uniqueCodeMin" INTEGER NOT NULL DEFAULT 100,
    "uniqueCodeMax" INTEGER NOT NULL DEFAULT 999,
    "methodBankTransfer" BOOLEAN NOT NULL DEFAULT true,
    "methodQris" BOOLEAN NOT NULL DEFAULT false,
    "methodIpaymu" BOOLEAN NOT NULL DEFAULT false,
    "methodXendit" BOOLEAN NOT NULL DEFAULT false,
    "gatewaySandbox" BOOLEAN NOT NULL DEFAULT true,
    "ipaymuFeePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "ipaymuFeeFlatIdr" INTEGER NOT NULL DEFAULT 0,
    "xenditFeePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "xenditFeeFlatIdr" INTEGER NOT NULL DEFAULT 0,
    "companyName" VARCHAR(160),
    "companyTaxId" VARCHAR(40),
    "companyPhone" VARCHAR(40),
    "companyEmail" VARCHAR(160),
    "companyWebsite" VARCHAR(200),
    "companyAddressId" TEXT,
    "termsDoc" TEXT,
    "footerNoteDoc" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "invoice_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "bankName" VARCHAR(80) NOT NULL,
    "accountNumber" VARCHAR(40) NOT NULL,
    "accountHolder" VARCHAR(120) NOT NULL,
    "branch" VARCHAR(120),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok (timestamptz)
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qris_accounts" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "emvPayload" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok (timestamptz)
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "qris_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rules" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "ratePercent" DECIMAL(6,3) NOT NULL,
    "basisPercent" DECIMAL(6,3) NOT NULL DEFAULT 100,
    "mode" "tax_mode" NOT NULL DEFAULT 'added',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok (timestamptz)
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_sequences" (
    "key" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoice_sequences_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_settings_companyAddressId_key" ON "invoice_settings"("companyAddressId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_bankName_accountNumber_key" ON "bank_accounts"("bankName", "accountNumber");

-- AddForeignKey
ALTER TABLE "invoice_settings" ADD CONSTRAINT "invoice_settings_companyAddressId_fkey" FOREIGN KEY ("companyAddressId") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Batas nilai di DB (selain validasi Zod): pengaturan tak boleh salah bentuk walau ditulis lewat jalur lain ──
ALTER TABLE "invoice_settings"
  ADD CONSTRAINT "invoice_settings_singleton" CHECK ("id" = 'global'),
  ADD CONSTRAINT "invoice_settings_number_padding" CHECK ("numberPadding" BETWEEN 1 AND 10),
  ADD CONSTRAINT "invoice_settings_due_days" CHECK ("defaultDueDays" BETWEEN 0 AND 365),
  ADD CONSTRAINT "invoice_settings_expire_days" CHECK ("expireDaysBeforeReference" BETWEEN 0 AND 365),
  ADD CONSTRAINT "invoice_settings_min_payment" CHECK ("minimumFirstPaymentPercent" BETWEEN 0 AND 100),
  ADD CONSTRAINT "invoice_settings_unique_code" CHECK ("uniqueCodeMin" >= 1 AND "uniqueCodeMax" <= 9999 AND "uniqueCodeMin" < "uniqueCodeMax"),
  ADD CONSTRAINT "invoice_settings_fees" CHECK (
    "ipaymuFeePercent" BETWEEN 0 AND 100 AND "xenditFeePercent" BETWEEN 0 AND 100
    AND "ipaymuFeeFlatIdr" BETWEEN 0 AND 10000000 AND "xenditFeeFlatIdr" BETWEEN 0 AND 10000000
  ),
  ADD CONSTRAINT "invoice_settings_number_prefix" CHECK ("numberPrefix" ~ '^[A-Za-z0-9._/-]{0,12}$'),
  ADD CONSTRAINT "invoice_settings_number_pattern" CHECK (position('{SEQ}' in "numberPattern") > 0);

ALTER TABLE "tax_rules"
  ADD CONSTRAINT "tax_rules_rate" CHECK ("ratePercent" BETWEEN 0 AND 100),
  ADD CONSTRAINT "tax_rules_basis" CHECK ("basisPercent" > 0 AND "basisPercent" <= 100),
  ADD CONSTRAINT "tax_rules_name" CHECK (length(btrim("name")) > 0);

ALTER TABLE "bank_accounts"
  ADD CONSTRAINT "bank_accounts_fields" CHECK (length(btrim("bankName")) > 0 AND length(btrim("accountNumber")) > 0 AND length(btrim("accountHolder")) > 0);

ALTER TABLE "qris_accounts" ADD CONSTRAINT "qris_accounts_name" CHECK (length(btrim("name")) > 0);

ALTER TABLE "invoice_sequences" ADD CONSTRAINT "invoice_sequences_last" CHECK ("lastNumber" >= 0);

-- ── Baris bawaan: pengaturan 'global' (semua kolom memakai DEFAULT) dan satu aturan PPN 0% (= tanpa pajak sampai diisi) ──
INSERT INTO "invoice_settings" ("id", "updatedAt") VALUES ('global', now()); -- tz-ok (timestamptz)
INSERT INTO "tax_rules" ("id", "name", "ratePercent", "basisPercent", "mode", "isActive", "sortOrder", "updatedAt")
VALUES (gen_random_uuid()::text, 'PPN', 0, 100, 'added', true, 0, now()); -- tz-ok (timestamptz)
