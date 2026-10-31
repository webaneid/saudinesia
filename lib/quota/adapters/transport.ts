import type { BookingTransport } from '@prisma/client'
import { reserveTransportQuota, confirmTransportQuota, releaseTransportQuota } from '@/lib/quota'
import type { QuotaAdapter } from './types'

export const transportAdapter: QuotaAdapter<BookingTransport> = {
  confirm: (tx, row) => confirmTransportQuota(tx, row.transportQuotaId, row.numPassengers),
  release: (tx, row, o) => releaseTransportQuota(tx, row.transportQuotaId, row.numPassengers, o.confirmed),
}

// reserve() dipanggil SEBELUM baris BookingTransport ada — argumennya nilai mentah, bukan row.
// Dipakai juga oleh tourPackageAdapter (kendaraan di Paket Ziarah reuse TransportQuota yang sama,
// docs/arsitektur-ziarah.md §8.1/§12.6).
export const reserveTransport = reserveTransportQuota
