-- AlterTable
ALTER TABLE "booking_pilgrims" DROP COLUMN "dateOfBirth",
DROP COLUMN "email",
DROP COLUMN "fullName",
DROP COLUMN "gender",
DROP COLUMN "nationality",
DROP COLUMN "passportExpiry",
DROP COLUMN "passportNumber",
DROP COLUMN "phone",
DROP COLUMN "phoneCountryCode",
DROP COLUMN "whatsapp",
DROP COLUMN "whatsappCountryCode",
ADD COLUMN     "fieldValues" JSONB NOT NULL DEFAULT '{}';

