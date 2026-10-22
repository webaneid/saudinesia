-- Pencabutan sesi (SEC-18): versi sesi per akun. Token tanpa/ber-versi lain ditolak oleh getSession().
ALTER TABLE "users" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
