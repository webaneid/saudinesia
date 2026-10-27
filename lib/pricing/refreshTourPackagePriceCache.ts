import { repriceOwner, repriceOwnerType } from './engine'

// Pembungkus tipis (Fase 1 harga terpadu): harga "mulai dari" Paket Ziarah dihitung & disimpan mesin `lib/pricing/engine` (titik harga `tour_package`)
// dengan penulisan ganda ke `TourPackage.price`. Nama lama dipertahankan; dihapus di Fase 5.

/** Dipanggil saat ProductCost/PreferredVendor/PricingRule paket ini berubah, hotel/kendaraan terpilih berubah, dan dari cron kurs. */
export async function refreshTourPackagePriceCache(tourPackageId: string): Promise<void> {
  await repriceOwner('tour_package', tourPackageId)
}

export async function refreshAllTourPackagePriceCaches(currencies?: string[]): Promise<void> {
  await repriceOwnerType('tour_package', currencies)
}
