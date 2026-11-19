-- Jejak keamanan staf (docs/rencana-audit-golive.md §6, SEC-304). Append-only; ditulis HANYA lib/audit/staff.ts.

-- CreateTable
CREATE TABLE "staff_audit_events" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok (timestamptz)
    "actorId" TEXT,
    "targetUserId" TEXT,
    "bookingId" TEXT,
    "action" VARCHAR(32) NOT NULL,
    "ip" VARCHAR(64),
    "summary" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "staff_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_audit_events_at_idx" ON "staff_audit_events"("at");

-- CreateIndex
CREATE INDEX "staff_audit_events_actorId_at_idx" ON "staff_audit_events"("actorId", "at");

-- CreateIndex
CREATE INDEX "staff_audit_events_targetUserId_at_idx" ON "staff_audit_events"("targetUserId", "at");

-- CreateIndex
CREATE INDEX "staff_audit_events_action_at_idx" ON "staff_audit_events"("action", "at");

ALTER TABLE "staff_audit_events" ADD CONSTRAINT "staff_audit_events_action_check" CHECK ("action" IN (
  'staff_create', 'staff_update', 'staff_reset_limits', 'staff_whatsapp_release', 'login_success', 'login_failed', 'documents_zip'
));
ALTER TABLE "staff_audit_events" ADD CONSTRAINT "staff_audit_events_summary_object" CHECK (jsonb_typeof("summary") = 'object');

-- ── Append-only: tak ada UPDATE/DELETE sama sekali (tanpa FK, jadi tak ada cascade yang perlu dilewatkan). ──
CREATE FUNCTION "staff_audit_events_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'staff_audit_events bersifat append-only (% ditolak)', TG_OP;
END
$$;
CREATE TRIGGER "staff_audit_events_no_change" BEFORE UPDATE OR DELETE ON "staff_audit_events" FOR EACH ROW EXECUTE FUNCTION "staff_audit_events_append_only"();
