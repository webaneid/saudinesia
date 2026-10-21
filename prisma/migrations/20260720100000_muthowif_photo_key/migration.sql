-- Rename photoUrl -> photoKey (docs/arsitektur-muthowif.md, menutup Gap #2): field ini tidak
-- pernah dipakai sebelumnya (selalu NULL di semua baris, dikonfirmasi sebelum migrasi ini) —
-- sekarang diaktifkan sebagai object key MinIO, bukan URL, sesuai konvensi CLAUDE.md.
ALTER TABLE "muthowif" DROP COLUMN "photoUrl",
ADD COLUMN     "photoKey" TEXT;
