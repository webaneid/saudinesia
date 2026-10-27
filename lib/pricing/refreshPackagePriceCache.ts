import { repriceOwner, repriceOwnerType } from './engine'

// Pembungkus tipis (Fase 1 harga terpadu): harga "mulai dari" Paket Umroh dihitung & disimpan mesin `lib/pricing/engine` (titik harga `package`, termasuk
// modal bagian yang diketahui) dengan penulisan ganda ke `Package.price`. Nama lama dipertahankan; dihapus di Fase 5.

/** Dipanggil setiap field yang memengaruhi harga berubah (mode/included*, Komponen Biaya) dan dari cron kurs. */
export async function refreshPackagePriceCache(packageId: string): Promise<void> {
  await repriceOwner('package', packageId)
}

export async function refreshAllPackagePriceCaches(currencies?: string[]): Promise<void> {
  await repriceOwnerType('package', currencies)
}
