-- AlterTable
ALTER TABLE "booking_pilgrims" ADD COLUMN     "phoneCountryCode" TEXT DEFAULT 'ID',
ADD COLUMN     "whatsapp" TEXT,
ADD COLUMN     "whatsappCountryCode" TEXT DEFAULT 'ID';

