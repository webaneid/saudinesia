-- CreateTable
CREATE TABLE "site_settings" (
    "id" TEXT NOT NULL,
    "platformName" TEXT,
    "metaTitle" TEXT,
    "metaDescription" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("id")
);

