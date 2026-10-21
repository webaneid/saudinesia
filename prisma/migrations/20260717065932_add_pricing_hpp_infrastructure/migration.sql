-- DropForeignKey
ALTER TABLE "transport_quotas" DROP CONSTRAINT "transport_quotas_routeId_fkey";

-- DropForeignKey
ALTER TABLE "transport_quotas" DROP CONSTRAINT "transport_quotas_vehicleId_fkey";

-- AlterTable
ALTER TABLE "booking_transports" ADD COLUMN     "dropoffDetail" TEXT,
ADD COLUMN     "pickupDetail" TEXT,
ADD COLUMN     "unitPrice" DECIMAL(12,2) NOT NULL,
ALTER COLUMN "numPassengers" SET DEFAULT 1;

-- AlterTable
ALTER TABLE "transport_quotas" DROP COLUMN "isCharter",
DROP COLUMN "routeId",
DROP COLUMN "vehicleId",
ADD COLUMN     "pricingId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "transport_vehicles" DROP COLUMN "priceCharterHajj",
DROP COLUMN "priceCharterRamadan",
DROP COLUMN "priceCharterRegular",
DROP COLUMN "pricePerSeatHajj",
DROP COLUMN "pricePerSeatRamadan",
DROP COLUMN "pricePerSeatRegular",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "fleetCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "images" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "visa_applications" ADD COLUMN     "visaProductId" TEXT;

-- AlterTable
ALTER TABLE "visa_products" ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'Saudi Arabia';

-- DropTable
DROP TABLE "transport_routes";

-- CreateTable
CREATE TABLE "transport_trips" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "originHint" TEXT,
    "destinationHint" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transport_trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_pricing" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "perSeatEnabled" BOOLEAN NOT NULL DEFAULT false,
    "charterRegular" DECIMAL(12,2),
    "charterRamadan" DECIMAL(12,2),
    "charterHajj" DECIMAL(12,2),
    "perSeatRegular" DECIMAL(12,2),
    "perSeatRamadan" DECIMAL(12,2),
    "perSeatHajj" DECIMAL(12,2),

    CONSTRAINT "transport_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'Saudi Arabia',
    "contactInfo" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" TEXT NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL DEFAULT 'IDR',
    "midRate" DECIMAL(12,4) NOT NULL,
    "spreadPercent" DECIMAL(5,2) NOT NULL,
    "sellRate" DECIMAL(12,4) NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_costs" (
    "id" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "costComponent" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "costTiers" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,

    CONSTRAINT "product_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rules" (
    "id" TEXT NOT NULL,
    "productType" TEXT,
    "minMarginPercent" DECIMAL(5,2) NOT NULL,
    "roundingIncrement" INTEGER NOT NULL DEFAULT 50000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preferred_vendors" (
    "id" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "costComponent" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,

    CONSTRAINT "preferred_vendors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transport_pricing_tripId_vehicleId_key" ON "transport_pricing"("tripId", "vehicleId");

-- CreateIndex
CREATE INDEX "exchange_rates_fromCurrency_toCurrency_fetchedAt_idx" ON "exchange_rates"("fromCurrency", "toCurrency", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_rules_productType_key" ON "pricing_rules"("productType");

-- CreateIndex
CREATE UNIQUE INDEX "preferred_vendors_productType_productId_costComponent_key" ON "preferred_vendors"("productType", "productId", "costComponent");

-- CreateIndex
CREATE UNIQUE INDEX "transport_quotas_pricingId_travelDate_key" ON "transport_quotas"("pricingId", "travelDate");

-- AddForeignKey
ALTER TABLE "transport_pricing" ADD CONSTRAINT "transport_pricing_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "transport_trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_pricing" ADD CONSTRAINT "transport_pricing_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "transport_vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_quotas" ADD CONSTRAINT "transport_quotas_pricingId_fkey" FOREIGN KEY ("pricingId") REFERENCES "transport_pricing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_applications" ADD CONSTRAINT "visa_applications_visaProductId_fkey" FOREIGN KEY ("visaProductId") REFERENCES "visa_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_costs" ADD CONSTRAINT "product_costs_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

