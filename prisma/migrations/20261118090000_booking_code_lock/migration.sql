-- Tabel kosong, hanya sasaran `LOCK TABLE` yang menyerialkan pembuat kode booking (lib/utils/bookingCode.ts).
CREATE TABLE "booking_code_lock" (
    "id" INTEGER NOT NULL,

    CONSTRAINT "booking_code_lock_pkey" PRIMARY KEY ("id")
);
