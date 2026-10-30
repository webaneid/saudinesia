-- Zona waktu sesi database = UTC (docs/arsitektur-booking-engine-v2.md §5, Fase 1).
-- Prisma menulis instan ke kolom `timestamp` (tanpa zona) sebagai UTC; SQL mentah yang memakai now()/CURRENT_TIMESTAMP memakai zona SESI. Postgres dev berzona Asia/Jakarta
-- sedangkan produksi UTC membuat keduanya berbeda diam-diam (mis. migrasi 20261021150000 menulis jam WIB ke kolom tanpa zona). Memaksa UTC di tingkat database membuat semua
-- lingkungan identik. Berlaku untuk koneksi BARU; koneksi yang sudah terbuka memakai zona lama sampai tersambung ulang (bersifat sementara, tak ada data diubah).
-- DO + EXECUTE: ALTER DATABASE tak menerima current_database() langsung. Idempoten.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO ''UTC''', current_database());
END
$$;
