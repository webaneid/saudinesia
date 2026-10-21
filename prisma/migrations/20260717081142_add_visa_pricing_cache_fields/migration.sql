-- AlterTable
ALTER TABLE "visa_products" ADD COLUMN     "durationFeeRules" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "requiredComponents" JSONB NOT NULL DEFAULT '[]';

