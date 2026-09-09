import type { BookingCatering } from '@prisma/client'
import type { QuotaAdapter } from './types'

// Katering tidak berkapasitas (sesuai model bisnis saat ini) — no-op EKSPLISIT, bukan lupa
// ditambahkan (docs/arsitektur-booking.md §7 keputusan #6).
export const cateringAdapter: QuotaAdapter<BookingCatering> = {
  confirm: async () => {},
  release: async () => {},
}
