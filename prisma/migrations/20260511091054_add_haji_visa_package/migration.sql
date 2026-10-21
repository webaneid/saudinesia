-- CreateTable
CREATE TABLE "haji_products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "hajiType" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "departureDate" DATE,
    "returnDate" DATE,
    "durationDays" INTEGER,
    "includes" JSONB NOT NULL DEFAULT '[]',
    "price" DECIMAL(14,2) NOT NULL,
    "priceLabel" TEXT,
    "totalQuota" INTEGER NOT NULL DEFAULT 0,
    "bookedQuota" INTEGER NOT NULL DEFAULT 0,
    "images" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "haji_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visa_products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "visaType" TEXT NOT NULL,
    "description" TEXT,
    "requirements" JSONB NOT NULL DEFAULT '[]',
    "price" DECIMAL(12,2) NOT NULL,
    "priceLabel" TEXT,
    "processDays" INTEGER NOT NULL DEFAULT 14,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visa_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(14,2) NOT NULL,
    "priceLabel" TEXT,
    "highlights" JSONB NOT NULL DEFAULT '[]',
    "images" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_items" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,

    CONSTRAINT "package_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_haji" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "hajiProductId" TEXT NOT NULL,
    "numPersons" INTEGER NOT NULL DEFAULT 1,
    "totalPrice" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "booking_haji_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_visa" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "visaProductId" TEXT NOT NULL,
    "numPersons" INTEGER NOT NULL DEFAULT 1,
    "totalPrice" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "booking_visa_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "package_items" ADD CONSTRAINT "package_items_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_haji" ADD CONSTRAINT "booking_haji_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_haji" ADD CONSTRAINT "booking_haji_hajiProductId_fkey" FOREIGN KEY ("hajiProductId") REFERENCES "haji_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_visa" ADD CONSTRAINT "booking_visa_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_visa" ADD CONSTRAINT "booking_visa_visaProductId_fkey" FOREIGN KEY ("visaProductId") REFERENCES "visa_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
