-- Template WhatsApp yang bisa diedit (docs/rencana-gowa-self-host.md §4.2, F3). Satu baris per kunci; body NULL = teks bawaan di kode.
-- Daftar kunci HARUS sama dengan WA_TEMPLATE_KEYS (lib/whatsapp/templateDefs.ts) — dijaga scripts/test-whatsapp-templates.ts.
CREATE TABLE "whatsapp_templates" (
    "key" VARCHAR(40) NOT NULL,
    "body" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok: kolom timestamptz
    CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "whatsapp_templates_key" CHECK ("key" IN ('invoice_issued', 'payment_reminder_unpaid', 'payment_reminder_partial', 'payment_confirmed_full', 'payment_confirmed_partial', 'payment_rejected', 'departure_reminder')),
    CONSTRAINT "whatsapp_templates_body" CHECK ("body" IS NULL OR (char_length("body") BETWEEN 1 AND 1000))
);

INSERT INTO "whatsapp_templates" ("key") VALUES
  ('invoice_issued'), ('payment_reminder_unpaid'), ('payment_reminder_partial'), ('payment_confirmed_full'),
  ('payment_confirmed_partial'), ('payment_rejected'), ('departure_reminder');
