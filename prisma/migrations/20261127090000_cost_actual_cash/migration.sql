-- Fase 7b-2b: pengeluaran vendor → buku kas (docs/arsitektur-booking-engine-v2.md §10.10).
ALTER TABLE "cost_actuals" ADD COLUMN "cashAccountId" TEXT,
ADD COLUMN "cashRefVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "cost_actuals" ADD CONSTRAINT "cost_actuals_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sudah diposting (versi > 0) ⇒ akun kas diketahui; versi tak negatif. Baris lama tetap versi 0 tanpa akun (buku kas mulai dari penerapan, tanpa pengisian ulang).
ALTER TABLE "cost_actuals" ADD CONSTRAINT "cost_actuals_cash_check" CHECK ("cashRefVersion" >= 0 AND ("cashRefVersion" = 0 OR "cashAccountId" IS NOT NULL));
