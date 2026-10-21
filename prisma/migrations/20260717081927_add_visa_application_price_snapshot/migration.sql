-- AlterTable
ALTER TABLE "visa_applications" ADD COLUMN     "exchangeRateIdsUsed" JSONB,
ADD COLUMN     "hppSnapshotRupiah" DECIMAL(14,2),
ADD COLUMN     "selectedDurationDays" INTEGER,
ADD COLUMN     "sellPriceSnapshot" DECIMAL(14,2),
ADD COLUMN     "vendorIdsUsed" JSONB;

