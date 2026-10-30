-- Penguatan Pengaturan Invoice setelah audit keamanan Fase 2 (SEC-109, SEC-115): jejak perubahan append-only + CHECK bentuk yang sebelumnya hanya di Zod.
-- Aditif; baris bawaan 'global' memenuhi semua CHECK baru.

-- CreateTable
CREATE TABLE "settings_audit" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok (timestamptz)
    "staffId" TEXT NOT NULL,
    "entity" VARCHAR(40) NOT NULL,
    "entityId" VARCHAR(64) NOT NULL,
    "action" VARCHAR(16) NOT NULL,
    "summary" JSONB NOT NULL,

    CONSTRAINT "settings_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "settings_audit_entity_entityId_at_idx" ON "settings_audit"("entity", "entityId", "at");

-- CreateIndex
CREATE INDEX "settings_audit_at_idx" ON "settings_audit"("at");

-- ── Append-only: jejak tak boleh diubah/dihapus lewat jalur mana pun (koreksi = baris baru) ──
CREATE FUNCTION "settings_audit_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'settings_audit bersifat append-only (% ditolak)', TG_OP;
END
$$;
CREATE TRIGGER "settings_audit_no_change" BEFORE UPDATE OR DELETE ON "settings_audit" FOR EACH ROW EXECUTE FUNCTION "settings_audit_append_only"();

-- ── CHECK bentuk (sejajar Zod; nomor invoice dicetak di invoice publik/PDF/email/nama berkas) ──
ALTER TABLE "invoice_settings"
  ADD CONSTRAINT "invoice_settings_number_pattern_charset" CHECK ("numberPattern" ~ '^[A-Za-z0-9._/{}-]{1,60}$' AND length("numberPattern") - length(replace("numberPattern", '{SEQ}', '')) = 5),
  ADD CONSTRAINT "invoice_settings_website" CHECK ("companyWebsite" IS NULL OR "companyWebsite" ~* '^https?://[^[:space:]"''<>]+$'),
  ADD CONSTRAINT "invoice_settings_timezone_shape" CHECK ("appTimezone" ~ '^[A-Za-z][A-Za-z0-9_+/-]{0,63}$');
ALTER TABLE "qris_accounts" ADD CONSTRAINT "qris_accounts_payload" CHECK ("emvPayload" IS NULL OR "emvPayload" ~ '^000201[ -~]+$');
