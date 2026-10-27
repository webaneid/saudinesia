-- Fase 5 harga terpadu (docs/arsitektur-harga-terpadu.md §18): margin aturan hanyalah SARAN harga otomatis (harga jual bisa diatur manual), bukan batas minimum —
-- nama kolom mengikuti maknanya. Rename murni (nilai tidak berubah).
ALTER TABLE "pricing_rules" RENAME COLUMN "minMarginPercent" TO "defaultMarginPercent";
