import type { Prisma } from '@prisma/client'

/**
 * Kolom jamaah booking yang BOLEH dibaca halaman/API/PDF (tanpa kolom NIK/paspor tersegel, docs/arsitektur-jamaah.md §5.4). Pembaca relasi
 * `pilgrims` WAJIB memakai `select` ini, bukan `include`/`true` (yang membawa semua kolom skalar termasuk cipher) — dijaga scripts/test-booking-link.ts.
 * Berkas sendiri (tanpa impor layanan) supaya pembaca mana pun bisa memakainya tanpa menarik lib/pii.
 */
export const BOOKING_PILGRIM_SAFE_SELECT = {
  id: true, bookingId: true, userId: true, isLeader: true, fieldValues: true, savedPilgrimId: true, passportLast4: true,
} as const satisfies Prisma.BookingPilgrimSelect
