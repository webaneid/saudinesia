-- Pembersihan sisa desain lama (docs/arsitektur-tabel.md; keputusan pemilik 2026-10-30: booking engine akan dibuat baru): modul Group Booking (groups, group_members,
-- bookings.groupId) tak pernah dibangun, dan booking_visa tak pernah diisi kode mana pun (visa ada di VisaApplication per jamaah). Fail-closed: bila ada data, migrasi BERHENTI.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "groups") OR EXISTS (SELECT 1 FROM "group_members") OR EXISTS (SELECT 1 FROM "booking_visa") OR EXISTS (SELECT 1 FROM "bookings" WHERE "groupId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Migrasi dibatalkan: groups / group_members / booking_visa / bookings.groupId berisi data (modul ini belum pernah dipakai) — periksa dulu, jangan dibuang diam-diam';
  END IF;
END $$;

ALTER TABLE "bookings" DROP CONSTRAINT "bookings_groupId_fkey";
ALTER TABLE "bookings" DROP COLUMN "groupId";
DROP TABLE "group_members";
DROP TABLE "groups";
DROP TABLE "booking_visa";
