import { hotelAdapter } from './hotel'
import { transportAdapter } from './transport'
import { muthowifAdapter } from './muthowif'
import { cateringAdapter } from './catering'
import { tourPackageAdapter } from './tourPackage'
import { visaAdapter } from './visa'
import { hajiAdapter } from './haji'
import { flightAdapter, packageAdapter } from './flight'

// Registry lengkap secara statis (object literal, bukan Record<K,V> generik seragam — tiap
// adapter beroperasi atas baris tipenya sendiri, lihat lib/quota/adapters/types.ts) — TypeScript
// akan error compile-time kalau satu key hilang, sama seperti maksud docs/arsitektur-booking.md
// §3.2 (kelas bug "satu tipe terlupa di satu titik" jadi mustahil). Semua tipe dipanggil dari
// konfirmasi pembayaran (confirm), pembatalan (release, lib/booking/cancel.ts), dan pembuatan
// booking (reserve*) — termasuk haji (docs/arsitektur-haji.md §6).
export const quotaAdapters = {
  hotel: hotelAdapter,
  transport: transportAdapter,
  muthowif: muthowifAdapter,
  catering: cateringAdapter,
  tourPackage: tourPackageAdapter,
  visa: visaAdapter,
  haji: hajiAdapter,
  flight: flightAdapter,
  package: packageAdapter,
}

export { reserveHotel } from './hotel'
export { reserveTransport } from './transport'
export { reserveMuthowifPool } from './muthowif'
export { reserveHaji } from './haji'
export type { QuotaAdapter, Tx } from './types'
