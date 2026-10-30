-- Form booking admin (docs/arsitektur-booking-engine-v2.md §10.3, Fase 5). ADITIF — tak ada data lama yang diubah.
-- • bookings.draft: isi draf (masukan pesan) — hanya boleh terisi selama status `draft` (CHECK), dikosongkan saat terbit.
-- • visa_applications.plannedTravelDate: rencana tanggal berangkat jamaah (D1).
ALTER TABLE "bookings" ADD COLUMN "draft" JSONB;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_draft_only_in_draft" CHECK ("draft" IS NULL OR ("status" = 'draft' AND jsonb_typeof("draft") = 'object'));

ALTER TABLE "visa_applications" ADD COLUMN "plannedTravelDate" DATE;
