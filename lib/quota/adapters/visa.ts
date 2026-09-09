import type { QuotaAdapter } from './types'

// Visa tidak pakai kuota sama sekali — dokumen (VisaApplication) dibuat lewat mekanisme terpisah
// (BookingPilgrim + VisaApplication, docs/arsitektur-booking.md §3.3), bukan lewat baris
// BookingVisa. No-op EKSPLISIT supaya registry §Fase 1 tetap lengkap untuk 7 tipe (bukan lupa
// ditambahkan) — lihat docs/arsitektur-booking.md §3.2.
export const visaAdapter: QuotaAdapter<unknown> = {
  confirm: async () => {},
  release: async () => {},
}
