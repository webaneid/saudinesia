import type { BookingFlight, BookingPackage } from '@prisma/client'
import type { QuotaAdapter } from './types'
import { confirmFlightQuota, releaseFlightQuota } from '@/lib/quota'

// Kursi tiket pesawat (docs/arsitektur-booking-engine-v2.md §10.2): ditahan saat booking dibuat (`reserveFlightQuota`, route POST /bookings), dikonfirmasi saat
// pembayaran dikonfirmasi, dilepas saat batal/hangus. Item tiket menahan `numPassengers` kursi; item Paket Umroh menahan `numPeople` kursi pada tiket paketnya.
export const flightAdapter: QuotaAdapter<BookingFlight> = {
  confirm: (tx, row) => confirmFlightQuota(tx, row.flightScheduleId, row.numPassengers),
  release: (tx, row) => releaseFlightQuota(tx, row.flightScheduleId, row.numPassengers),
}

// Hotel/transport paket TIDAK ditahan di Fase 4 (template statis — konsisten Paket Ziarah, dicatat sebagai gap §10.2); hanya kursi tiket.
export const packageAdapter: QuotaAdapter<BookingPackage> = {
  confirm: async (tx, row) => { if (row.flightScheduleId) await confirmFlightQuota(tx, row.flightScheduleId, row.numPeople) },
  release: async (tx, row) => { if (row.flightScheduleId) await releaseFlightQuota(tx, row.flightScheduleId, row.numPeople) },
}
