import { repriceOwner, repriceOwnerType } from './engine'

// Pembungkus tipis (Fase 1 harga terpadu): harga rute×kendaraan dihitung & disimpan mesin `lib/pricing/engine` (titik harga `transport` + penulisan ganda
// ke `TransportPricing.price`). Nama lama dipertahankan; dihapus di Fase 5.

/** Hitung ulang harga satu kombinasi rute×kendaraan — dipanggil saat ProductCost/PreferredVendor/PricingRule-nya berubah. */
export async function refreshTransportPricingCache(pricingId: string): Promise<void> {
  await repriceOwner('transport', pricingId)
}

/** Semua pricing aktif; `currencies` (cron kurs) = hanya yang biayanya memakai mata uang itu. */
export async function refreshAllTransportPricingCaches(currencies?: string[]): Promise<void> {
  await repriceOwnerType('transport', currencies)
}
