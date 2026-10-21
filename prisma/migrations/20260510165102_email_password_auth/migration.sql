-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('pilgrim', 'agent', 'admin', 'superadmin');

-- CreateEnum
CREATE TYPE "booking_status" AS ENUM ('awaiting_payment', 'payment_review', 'confirmed', 'active', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "visa_status" AS ENUM ('pending_documents', 'documents_complete', 'submitted_to_syarikah', 'in_review', 'issued', 'rejected');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('pending', 'confirmed', 'rejected');

-- CreateEnum
CREATE TYPE "refund_status" AS ENUM ('pending', 'approved', 'paid', 'rejected');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "phoneVerifiedAt" TIMESTAMP(3),
    "role" "user_role" NOT NULL DEFAULT 'pilgrim',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "resetToken" TEXT,
    "resetTokenExp" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_requests" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasons" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "stars" INTEGER,
    "distanceToHaramM" INTEGER,
    "description" TEXT,
    "images" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "hotels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_rooms" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "roomType" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "amenities" JSONB NOT NULL DEFAULT '[]',
    "priceRegular" DECIMAL(12,2) NOT NULL,
    "priceRamadan" DECIMAL(12,2) NOT NULL,
    "priceHajj" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "hotel_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_quotas" (
    "id" TEXT NOT NULL,
    "hotelRoomId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "totalQuota" INTEGER NOT NULL,
    "pendingQuota" INTEGER NOT NULL DEFAULT 0,
    "bookedQuota" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "hotel_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_services" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "serviceType" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "hotel_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_vehicles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vehicleType" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "priceCharterRegular" DECIMAL(12,2),
    "priceCharterRamadan" DECIMAL(12,2),
    "priceCharterHajj" DECIMAL(12,2),
    "pricePerSeatRegular" DECIMAL(12,2),
    "pricePerSeatRamadan" DECIMAL(12,2),
    "pricePerSeatHajj" DECIMAL(12,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "transport_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_routes" (
    "id" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "tripType" TEXT NOT NULL,

    CONSTRAINT "transport_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_quotas" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "travelDate" DATE NOT NULL,
    "isCharter" BOOLEAN NOT NULL DEFAULT false,
    "totalSeats" INTEGER NOT NULL,
    "pendingSeats" INTEGER NOT NULL DEFAULT 0,
    "bookedSeats" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "transport_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "muthowif" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bio" TEXT,
    "photoUrl" TEXT,
    "languages" JSONB NOT NULL DEFAULT '[]',
    "rating" DECIMAL(3,2) NOT NULL DEFAULT 5.00,
    "dailyCapacity" INTEGER NOT NULL DEFAULT 50,
    "priceRegular" DECIMAL(12,2) NOT NULL,
    "priceRamadan" DECIMAL(12,2) NOT NULL,
    "priceHajj" DECIMAL(12,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "muthowif_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "muthowif_availability" (
    "id" TEXT NOT NULL,
    "muthowifId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "pendingCount" INTEGER NOT NULL DEFAULT 0,
    "bookedCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "muthowif_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catering_options" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "boardType" TEXT NOT NULL,
    "menuStyle" TEXT NOT NULL,
    "pricePerPersonRegular" DECIMAL(12,2) NOT NULL,
    "pricePerPersonRamadan" DECIMAL(12,2) NOT NULL,
    "pricePerPersonHajj" DECIMAL(12,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "catering_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "heritage_tours" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "city" TEXT,
    "durationHours" DECIMAL(4,1),
    "maxGroupSize" INTEGER,
    "pricePerPerson" DECIMAL(12,2) NOT NULL,
    "images" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "heritage_tours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL,
    "groupCode" TEXT NOT NULL,
    "groupName" TEXT,
    "leaderUserId" TEXT NOT NULL,
    "totalMembers" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_members" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT,
    "inviteToken" TEXT,
    "status" TEXT NOT NULL DEFAULT 'invited',

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "bookingCode" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" TEXT,
    "status" "booking_status" NOT NULL DEFAULT 'awaiting_payment',
    "departureDate" DATE NOT NULL,
    "returnDate" DATE NOT NULL,
    "season" TEXT NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "paymentDeadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_pilgrims" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "userId" TEXT,
    "fullName" TEXT NOT NULL,
    "gender" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "passportNumber" TEXT,
    "passportExpiry" DATE,
    "nationality" TEXT NOT NULL DEFAULT 'Indonesian',
    "dateOfBirth" DATE,
    "isLeader" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "booking_pilgrims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visa_applications" (
    "id" TEXT NOT NULL,
    "bookingPilgrimId" TEXT NOT NULL,
    "visaType" TEXT NOT NULL,
    "status" "visa_status" NOT NULL DEFAULT 'pending_documents',
    "submittedAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "isForceMajeure" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "visa_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "bookingPilgrimId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSizeBytes" INTEGER,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_hotels" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "hotelQuotaId" TEXT NOT NULL,
    "hotelRoomId" TEXT NOT NULL,
    "checkIn" DATE NOT NULL,
    "checkOut" DATE NOT NULL,
    "nights" INTEGER NOT NULL,
    "numRooms" INTEGER NOT NULL DEFAULT 1,
    "numGuests" INTEGER NOT NULL,
    "pricePerNight" DECIMAL(12,2) NOT NULL,
    "totalPrice" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "booking_hotels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_transports" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "transportQuotaId" TEXT NOT NULL,
    "travelDate" DATE NOT NULL,
    "numPassengers" INTEGER NOT NULL,
    "isCharter" BOOLEAN NOT NULL DEFAULT false,
    "totalPrice" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "booking_transports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_muthowif" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "muthowifId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "numDays" INTEGER NOT NULL,
    "numPeople" INTEGER NOT NULL,
    "totalPrice" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "booking_muthowif_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_catering" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "cateringOptionId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "numDays" INTEGER NOT NULL,
    "numPeople" INTEGER NOT NULL,
    "totalPrice" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "booking_catering_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_tours" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "heritageTourId" TEXT NOT NULL,
    "tourDate" DATE NOT NULL,
    "numPeople" INTEGER NOT NULL,
    "totalPrice" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "booking_tours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_services" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "hotelServiceId" TEXT NOT NULL,
    "serviceDate" DATE,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "totalPrice" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "booking_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" TEXT NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'pending',
    "buktiTransferPath" TEXT,
    "buktiTransferUploadedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "isForceMajeure" BOOLEAN NOT NULL DEFAULT false,
    "status" "refund_status" NOT NULL DEFAULT 'pending',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookingId" TEXT,
    "channel" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "messagePreview" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_resetToken_key" ON "users"("resetToken");

-- CreateIndex
CREATE INDEX "otp_requests_phone_idx" ON "otp_requests"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "muthowif_availability_muthowifId_date_key" ON "muthowif_availability"("muthowifId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "groups_groupCode_key" ON "groups"("groupCode");

-- CreateIndex
CREATE UNIQUE INDEX "group_members_inviteToken_key" ON "group_members"("inviteToken");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_bookingCode_key" ON "bookings"("bookingCode");

-- CreateIndex
CREATE INDEX "bookings_userId_idx" ON "bookings"("userId");

-- CreateIndex
CREATE INDEX "bookings_status_idx" ON "bookings"("status");

-- CreateIndex
CREATE INDEX "bookings_status_paymentDeadline_idx" ON "bookings"("status", "paymentDeadline");

-- CreateIndex
CREATE INDEX "booking_pilgrims_bookingId_idx" ON "booking_pilgrims"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "visa_applications_bookingPilgrimId_key" ON "visa_applications"("bookingPilgrimId");

-- CreateIndex
CREATE INDEX "documents_bookingPilgrimId_idx" ON "documents"("bookingPilgrimId");

-- CreateIndex
CREATE INDEX "payments_bookingId_idx" ON "payments"("bookingId");

-- CreateIndex
CREATE INDEX "notification_logs_userId_idx" ON "notification_logs"("userId");

-- CreateIndex
CREATE INDEX "notification_logs_bookingId_idx" ON "notification_logs"("bookingId");

-- AddForeignKey
ALTER TABLE "hotel_rooms" ADD CONSTRAINT "hotel_rooms_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "hotels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_quotas" ADD CONSTRAINT "hotel_quotas_hotelRoomId_fkey" FOREIGN KEY ("hotelRoomId") REFERENCES "hotel_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_services" ADD CONSTRAINT "hotel_services_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "hotels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_quotas" ADD CONSTRAINT "transport_quotas_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "transport_vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_quotas" ADD CONSTRAINT "transport_quotas_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "transport_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "muthowif_availability" ADD CONSTRAINT "muthowif_availability_muthowifId_fkey" FOREIGN KEY ("muthowifId") REFERENCES "muthowif"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_leaderUserId_fkey" FOREIGN KEY ("leaderUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_pilgrims" ADD CONSTRAINT "booking_pilgrims_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_applications" ADD CONSTRAINT "visa_applications_bookingPilgrimId_fkey" FOREIGN KEY ("bookingPilgrimId") REFERENCES "booking_pilgrims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_bookingPilgrimId_fkey" FOREIGN KEY ("bookingPilgrimId") REFERENCES "booking_pilgrims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_hotels" ADD CONSTRAINT "booking_hotels_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_hotels" ADD CONSTRAINT "booking_hotels_hotelQuotaId_fkey" FOREIGN KEY ("hotelQuotaId") REFERENCES "hotel_quotas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_hotels" ADD CONSTRAINT "booking_hotels_hotelRoomId_fkey" FOREIGN KEY ("hotelRoomId") REFERENCES "hotel_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_transports" ADD CONSTRAINT "booking_transports_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_transports" ADD CONSTRAINT "booking_transports_transportQuotaId_fkey" FOREIGN KEY ("transportQuotaId") REFERENCES "transport_quotas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_muthowif" ADD CONSTRAINT "booking_muthowif_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_muthowif" ADD CONSTRAINT "booking_muthowif_muthowifId_fkey" FOREIGN KEY ("muthowifId") REFERENCES "muthowif"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_catering" ADD CONSTRAINT "booking_catering_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_catering" ADD CONSTRAINT "booking_catering_cateringOptionId_fkey" FOREIGN KEY ("cateringOptionId") REFERENCES "catering_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_tours" ADD CONSTRAINT "booking_tours_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_tours" ADD CONSTRAINT "booking_tours_heritageTourId_fkey" FOREIGN KEY ("heritageTourId") REFERENCES "heritage_tours"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_services" ADD CONSTRAINT "booking_services_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_services" ADD CONSTRAINT "booking_services_hotelServiceId_fkey" FOREIGN KEY ("hotelServiceId") REFERENCES "hotel_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
