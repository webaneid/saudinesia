import type { PriceOwner, PriceOwnerType } from '../types'
import { flightOwner, hotelOwner, muthowifOwner, transportOwner } from './base'
import { hajiOwner, packageOwner, tourPackageOwner } from './composite'
import { cateringOwner, hotelServiceOwner } from './manualOnly'
import { visaOwner } from './visa'

// REGISTRY pemilik harga (pola costComponentOwners / registry media). Menambah produk yang dijual = satu entri di sini.
// URUTAN penting: modul dasar dulu, komposit terakhir — komposit membaca titik harga (modal) modul dasar.
export const PRICE_OWNERS = {
  visa: visaOwner,
  flight: flightOwner,
  hotel: hotelOwner,
  transport: transportOwner,
  muthowif: muthowifOwner,
  tour_package: tourPackageOwner,
  package: packageOwner,
  haji: hajiOwner,
  catering: cateringOwner,
  hotel_service: hotelServiceOwner,
} as const satisfies Record<PriceOwnerType, PriceOwner>

export const PRICE_OWNER_TYPES = Object.keys(PRICE_OWNERS) as PriceOwnerType[]
export const priceOwner = (t: PriceOwnerType): PriceOwner => PRICE_OWNERS[t]
