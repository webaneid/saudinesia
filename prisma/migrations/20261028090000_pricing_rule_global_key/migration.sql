-- Aturan margin GLOBAL satu-satunya (docs/arsitektur-harga-terpadu.md §1.2-7, Fase 0).
-- Sebelumnya productType NULL = global; Postgres mengizinkan banyak NULL pada indeks unik, jadi permintaan paralel membuat baris global ganda
-- (getMarginRule memakai findFirst → hasil acak). Kini kunci sentinel 'global' (non-NULL) sehingga @@unique benar-benar menjamin satu baris.
-- Atomik (satu transaksi migrasi), fail-closed: bila sudah ada baris bertipe 'global' di samping baris NULL, UPDATE melanggar indeks unik dan migrasi gagal.

-- 1. Pertahankan SATU baris global NULL: yang paling baru diubah (seri → id terbesar).
DELETE FROM "pricing_rules" p
USING "pricing_rules" q
WHERE p."productType" IS NULL AND q."productType" IS NULL
  AND (q."updatedAt" > p."updatedAt" OR (q."updatedAt" = p."updatedAt" AND q."id" > p."id"));

-- 2. NULL → kunci sentinel, lalu wajibkan non-NULL.
UPDATE "pricing_rules" SET "productType" = 'global' WHERE "productType" IS NULL;
ALTER TABLE "pricing_rules" ALTER COLUMN "productType" SET DEFAULT 'global';
ALTER TABLE "pricing_rules" ALTER COLUMN "productType" SET NOT NULL;
