import { repriceOwner, repriceOwnerType } from './engine'

// Pembungkus tipis (Fase 1 harga terpadu): harga Visa per rentang hari dihitung & disimpan mesin `lib/pricing/engine` (satu titik harga `visa` per tier,
// override jual per tier = harga manual varian itu) dengan penulisan ganda ke `VisaProduct.price` ("mulai dari" = termurah) dan `durationFeeRules`.
// Nama lama dipertahankan; dihapus di Fase 5.

/** Hitung ulang harga produk visa — dipanggil saat ProductCost/PreferredVendor/PricingRule produk ini berubah. */
export async function refreshVisaProductCache(productId: string): Promise<void> {
  await repriceOwner('visa', productId)
}

/** Semua produk visa aktif; `currencies` (cron kurs) = hanya yang biayanya memakai mata uang itu. */
export async function refreshAllVisaProductCaches(currencies?: string[]): Promise<void> {
  await repriceOwnerType('visa', currencies)
}
