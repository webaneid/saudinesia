-- Fase 7 harga terpadu (docs/arsitektur-harga-terpadu.md §20). Atomik (satu transaksi migrasi); ekspansi + perbaikan data jumlah pembayaran.

-- 1. Perbaikan data: unggah bukti membuat `payments.amount = 0` dan konfirmasi tak pernah menetapkannya (laporan Fase 6 membaca jumlah ini). Alur lama mengonfirmasi LUNAS,
--    jadi pembayaran terkonfirmasi bernilai 0 diisi total booking-nya. Pembayaran pending/ditolak tak disentuh (jumlahnya memang belum diverifikasi).
UPDATE "payments" p SET "amount" = b."totalAmount"
FROM "bookings" b
WHERE p."bookingId" = b."id" AND p."status" = 'confirmed' AND p."amount" = 0;

-- 2. Penyesuaian di total pesanan.
CREATE TABLE "booking_adjustments" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "amountIdr" DECIMAL(14,2) NOT NULL,
    "label" TEXT NOT NULL,
    "reason" TEXT,
    "totalBefore" DECIMAL(14,2) NOT NULL,
    "totalAfter" DECIMAL(14,2) NOT NULL,
    "costKnownIdr" DECIMAL(14,2) NOT NULL,
    "belowCost" BOOLEAN NOT NULL,
    "reversesId" TEXT,
    "byUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_adjustments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "booking_adjustments_reversesId_key" ON "booking_adjustments"("reversesId");
CREATE INDEX "booking_adjustments_bookingId_idx" ON "booking_adjustments"("bookingId");
ALTER TABLE "booking_adjustments" ADD CONSTRAINT "booking_adjustments_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_adjustments" ADD CONSTRAINT "booking_adjustments_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "booking_adjustments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_adjustments"
  ADD CONSTRAINT "booking_adjustments_amount_nonzero" CHECK ("amountIdr" <> 0),
  ADD CONSTRAINT "booking_adjustments_total_after_positive" CHECK ("totalAfter" > 0),
  ADD CONSTRAINT "booking_adjustments_total_consistent" CHECK ("totalAfter" = "totalBefore" + "amountIdr"),
  ADD CONSTRAINT "booking_adjustments_label_present" CHECK (length(btrim("label")) >= 1),
  -- total akhir di bawah HPP awal → catatan wajib (>= 3 karakter), dijaga DB bukan hanya kode
  ADD CONSTRAINT "booking_adjustments_below_cost_needs_reason" CHECK (NOT "belowCost" OR length(btrim(COALESCE("reason", ''))) >= 3),
  ADD CONSTRAINT "booking_adjustments_below_cost_consistent" CHECK ("belowCost" = ("totalAfter" < "costKnownIdr"));

-- 3. Pengeluaran aktual ke vendor.
CREATE TABLE "cost_actuals" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "vendorId" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "amountIdr" DECIMAL(14,2) NOT NULL,
    "paidAt" DATE NOT NULL,
    "isSettled" BOOLEAN NOT NULL DEFAULT false,
    "varianceNote" TEXT,
    "recordedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "cost_actuals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cost_actuals_bookingId_idx" ON "cost_actuals"("bookingId");
CREATE INDEX "cost_actuals_snapshotId_idx" ON "cost_actuals"("snapshotId");
CREATE INDEX "cost_actuals_vendorId_idx" ON "cost_actuals"("vendorId");
ALTER TABLE "cost_actuals" ADD CONSTRAINT "cost_actuals_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cost_actuals" ADD CONSTRAINT "cost_actuals_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "price_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cost_actuals" ADD CONSTRAINT "cost_actuals_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cost_actuals"
  ADD CONSTRAINT "cost_actuals_amounts_positive" CHECK ("amount" > 0 AND "amountIdr" > 0),
  ADD CONSTRAINT "cost_actuals_currency_upper" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "cost_actuals_idr_equal" CHECK ("currency" <> 'IDR' OR "amount" = "amountIdr"),
  ADD CONSTRAINT "cost_actuals_component_present" CHECK (length(btrim("component")) >= 1),
  ADD CONSTRAINT "cost_actuals_void_consistent" CHECK (("voidedAt" IS NULL) = ("voidedBy" IS NULL));
