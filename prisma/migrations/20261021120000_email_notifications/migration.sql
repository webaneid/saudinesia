-- Notifikasi email (docs/arsitektur-notifikasi.md §5)
ALTER TABLE "notification_logs" ADD COLUMN "externalId" TEXT;
CREATE INDEX "notification_logs_bookingId_type_channel_status_idx" ON "notification_logs"("bookingId", "type", "channel", "status");

ALTER TABLE "site_settings" ADD COLUMN "emailNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true;
