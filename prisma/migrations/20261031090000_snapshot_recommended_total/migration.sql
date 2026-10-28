-- Fase 8A harga terpadu (docs/arsitektur-harga-terpadu.md §21). Atomik (satu transaksi migrasi).

-- 1. Rekomendasi harga jual dibekukan PER BARIS saat dipesan: total harga OTOMATIS baris itu (HPP + margin bawaan saat itu), terlepas dari harga manual yang menang.
--    NULL = baris lama (sebelum kolom ini). TIDAK ada backfill: trigger beku menolak UPDATE; pembaca memakai aturan "baris otomatis → rekomendasi = jual".
ALTER TABLE "price_snapshots" ADD COLUMN "recommendedTotalIdr" DECIMAL(14,2);
ALTER TABLE "price_snapshots"
  ADD CONSTRAINT "price_snapshots_recommended_non_negative" CHECK ("recommendedTotalIdr" IS NULL OR "recommendedTotalIdr" >= 0 OR "lineKey" LIKE 'penyesuaian%');

-- 2. Peringatan di bawah HPP tidak lagi memblokir (arahan pemilik 2026-10-28): catatan alasan tidak lagi wajib di DB. `belowCost` tetap dicatat dan CHECK konsistensinya
--    (belowCost = totalAfter < costKnownIdr) tetap berlaku.
ALTER TABLE "booking_adjustments" DROP CONSTRAINT "booking_adjustments_below_cost_needs_reason";
