import type { HajiProduct } from '@prisma/client'

// Bentuk publik produk Haji (katalog API + halaman /haji). Peta EKSPLISIT: kolom kuota mentah (totalQuota/pendingQuota/bookedQuota) tidak boleh
// ikut ke respons publik (pola SEC-50), dan `available` memakai rumus yang sama dengan penegak kuota `reserveHaji` (total − pending − booked).

export const hajiAvailable = (p: Pick<HajiProduct, 'totalQuota' | 'pendingQuota' | 'bookedQuota'>) =>
  Math.max(0, p.totalQuota - p.pendingQuota - p.bookedQuota)

/** Harga sudah ditetapkan (cache > 0). Belum berharga → "Harga belum ditetapkan" dan tidak bisa dipesan (SEC-66). */
export const hajiPriced = (p: Pick<HajiProduct, 'price'>) => Number(p.price) > 0

export function toCatalogHaji(p: HajiProduct) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    hajiType: p.hajiType,
    year: p.year,
    departureDate: p.departureDate,
    returnDate: p.returnDate,
    durationDays: p.durationDays,
    includes: p.includes,
    priceLabel: p.priceLabel,
    price: Number(p.price),
    priced: hajiPriced(p),
    available: hajiAvailable(p),
  }
}
