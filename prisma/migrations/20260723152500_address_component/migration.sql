-- CreateEnum
CREATE TYPE "address_type" AS ENUM ('domestic', 'international');

-- CreateTable
CREATE TABLE "address_provinces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "address_provinces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "address_regencies" (
    "id" TEXT NOT NULL,
    "provinceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,

    CONSTRAINT "address_regencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "address_districts" (
    "id" TEXT NOT NULL,
    "regencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "address_districts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "address_villages" (
    "id" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "address_villages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" TEXT NOT NULL,
    "type" "address_type" NOT NULL,
    "fullAddress" TEXT NOT NULL,
    "postalCode" TEXT,
    "provinceId" TEXT,
    "regencyId" TEXT,
    "districtId" TEXT,
    "villageId" TEXT,
    "countryCode" TEXT,
    "city" TEXT,
    "stateRegion" TEXT,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "address_regencies_provinceId_idx" ON "address_regencies"("provinceId");

-- CreateIndex
CREATE INDEX "address_districts_regencyId_idx" ON "address_districts"("regencyId");

-- CreateIndex
CREATE INDEX "address_villages_districtId_idx" ON "address_villages"("districtId");

-- AddForeignKey
ALTER TABLE "address_regencies" ADD CONSTRAINT "address_regencies_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES "address_provinces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "address_districts" ADD CONSTRAINT "address_districts_regencyId_fkey" FOREIGN KEY ("regencyId") REFERENCES "address_regencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "address_villages" ADD CONSTRAINT "address_villages_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "address_districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES "address_provinces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_regencyId_fkey" FOREIGN KEY ("regencyId") REFERENCES "address_regencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "address_districts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_villageId_fkey" FOREIGN KEY ("villageId") REFERENCES "address_villages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

