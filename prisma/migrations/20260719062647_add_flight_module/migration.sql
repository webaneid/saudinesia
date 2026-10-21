
-- CreateTable
CREATE TABLE "flight_routes" (
    "id" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flight_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flight_schedules" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "departureFrom" DATE NOT NULL,
    "departureTo" DATE NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "totalSeats" INTEGER NOT NULL DEFAULT 0,
    "pendingSeats" INTEGER NOT NULL DEFAULT 0,
    "bookedSeats" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flight_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_flights" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "flightScheduleId" TEXT NOT NULL,
    "departureDate" DATE NOT NULL,
    "numPassengers" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "totalPrice" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "booking_flights_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "flight_schedules" ADD CONSTRAINT "flight_schedules_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "flight_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_flights" ADD CONSTRAINT "booking_flights_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_flights" ADD CONSTRAINT "booking_flights_flightScheduleId_fkey" FOREIGN KEY ("flightScheduleId") REFERENCES "flight_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

