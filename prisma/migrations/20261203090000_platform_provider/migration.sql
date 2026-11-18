-- Fase 13a (docs/arsitektur-bagi-hasil.md): penanda akun Platform Provider + versi setelan bagi hasil. Aditif.
ALTER TABLE "users" ADD COLUMN "isPlatformProvider" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "revenue_share_basis" AS ENUM ('margin', 'markup');

CREATE TABLE "revenue_share_settings" (
    "id" TEXT NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,
    "basis" "revenue_share_basis" NOT NULL,
    "note" VARCHAR(200),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok (kolom timestamptz)

    CONSTRAINT "revenue_share_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "revenue_share_settings_percent" CHECK ("percent" >= 0 AND "percent" <= 50)
);

CREATE INDEX "revenue_share_settings_createdAt_id_idx" ON "revenue_share_settings"("createdAt", "id");
ALTER TABLE "revenue_share_settings" ADD CONSTRAINT "revenue_share_settings_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only: riwayat kesepakatan tak pernah ditimpa atau dihapus (versi baru = baris baru).
CREATE FUNCTION "revenue_share_settings_frozen"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'revenue_share_settings append-only: % ditolak (versi baru = baris baru)', TG_OP;
END $$;
CREATE TRIGGER "revenue_share_settings_frozen" BEFORE UPDATE OR DELETE ON "revenue_share_settings" FOR EACH ROW EXECUTE FUNCTION "revenue_share_settings_frozen"();
CREATE TRIGGER "revenue_share_settings_no_truncate" BEFORE TRUNCATE ON "revenue_share_settings" FOR EACH STATEMENT EXECUTE FUNCTION "revenue_share_settings_frozen"();
