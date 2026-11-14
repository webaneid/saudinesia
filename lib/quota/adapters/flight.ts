import type { BookingFlight, BookingPackage } from '@prisma/client'
import type { QuotaAdapter } from './types'
import { confirmFlightQuota, confirmPackageDepartureQuota, releaseFlightQuota, releasePackageDepartureQuota } from '@/lib/quota'

// Kursi tiket pesawat (docs/arsitektur-booking-engine-v2.md §10.2): ditahan saat booking dibuat (`reserveFlightQuota`, route POST /bookings), dikonfirmasi saat
// pembayaran dikonfirmasi, dilepas saat batal/hangus. Item tiket menahan `numPassengers` kursi; item Paket Umroh menahan `numPeople` kursi pada tiket paketnya.
export const flightAdapter: QuotaAdapter<BookingFlight> = {
  confirm: (tx, row) => confirmFlightQuota(tx, row.flightScheduleId, row.numPassengers),
  release: (tx, row, o) => releaseFlightQuota(tx, row.flightScheduleId, row.numPassengers, o.confirmed),
}

// Paket Umroh: kursi KEBERANGKATAN (K1) dan kursi tiket paketnya. Hotel/transport paket TIDAK ditahan (template statis — gap §10.2).
// Baris lama tanpa keberangkatan (sebelum K1) hanya punya kursi tiket.
export const packageAdapter: QuotaAdapter<BookingPackage> = {
  confirm: async (tx, row) => {
    if (row.departureId) await confirmPackageDepartureQuota(tx, row.departureId, row.numPeople)
    if (row.flightScheduleId) await confirmFlightQuota(tx, row.flightScheduleId, row.numPeople)
  },
  release: async (tx, row, o) => {
    if (row.departureId) await releasePackageDepartureQuota(tx, row.departureId, row.numPeople, o.confirmed)
    if (row.flightScheduleId) await releaseFlightQuota(tx, row.flightScheduleId, row.numPeople, o.confirmed)
  },
}
