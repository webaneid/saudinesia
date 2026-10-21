-- CreateTable
CREATE TABLE "manifest_field_requirements" (
    "id" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "role" TEXT,

    CONSTRAINT "manifest_field_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "manifest_field_requirements_productType_productId_idx" ON "manifest_field_requirements"("productType", "productId");

