import { hotelAdapter } from './hotel'
import { transportAdapter } from './transport'
import { muthowifAdapter } from './muthowif'
import { cateringAdapter } from './catering'
import { tourPackageAdapter } from './tourPackage'
import { visaAdapter } from './visa'
import { hajiAdapter } from './haji'

// Registry lengkap secara statis (object literal, bukan Record<K,V> generik seragam — tiap
// adapter beroperasi atas baris tipenya sendiri, lihat lib/quota/adapters/types.ts) — TypeScript
// akan error compile-time kalau satu key hilang, sama seperti maksud docs/arsitektur-booking.md
// §3.2 (kelas bug "satu tipe terlupa di satu titik" jadi mustahil). haji terdaftar di registry
// (confirm/release) tapi BELUM dipanggil dari titik mana pun — booking Haji sendiri (createBooking
// menerima data.haji, reserve saat create) belum dibangun, di luar scope Fase 1-3 (lihat
// docs/arsitektur-booking.md §6 Step 5).
export const quotaAdapters = {
  hotel: hotelAdapter,
  transport: transportAdapter,
  muthowif: muthowifAdapter,
  catering: cateringAdapter,
  tourPackage: tourPackageAdapter,
  visa: visaAdapter,
  haji: hajiAdapter,
}

export { reserveHotel } from './hotel'
export { reserveTransport } from './transport'
export { reserveMuthowifPool } from './muthowif'
export { reserveHaji } from './haji'
export type { QuotaAdapter, Tx } from './types'
