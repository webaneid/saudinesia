-- SEC-101 (docs/arsitektur-harga-terpadu.md §21.10; docs/lessons-learned.md): jejak SIAPA dan KAPAN terakhir mengubah catatan alasan penyesuaian.
-- Catatan alasan kini opsional dan bisa diedit; tanpa jejak, alasan diskon rugi bisa ditulis ulang diam-diam. Baris lama: NULL (belum pernah diedit). Tanpa backfill.
ALTER TABLE "booking_adjustments" ADD COLUMN "reasonEditedByUserId" TEXT;
ALTER TABLE "booking_adjustments" ADD COLUMN "reasonEditedAt" TIMESTAMP(3);

-- Pelaku dan waktu selalu berpasangan (keduanya ada atau keduanya kosong).
ALTER TABLE "booking_adjustments" ADD CONSTRAINT "booking_adjustments_reason_edit_paired" CHECK (("reasonEditedByUserId" IS NULL) = ("reasonEditedAt" IS NULL));
