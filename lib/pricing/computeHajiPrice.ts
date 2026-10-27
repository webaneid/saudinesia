import { computeCostComponents, type ComponentBreakdown } from './costComponents'
import { repriceOwner, repriceOwnerType } from './engine'

// Harga Haji = jumlah harga jual PER KOMPONEN dari Komponen Biaya (docs/arsitektur-komponen-biaya.md §3.1, §3.3) — margin tipe `haji`
// (`PricingRule`), jatuh ke aturan global bila belum ada. `HajiProduct.price` hanyalah cache hasil ini, bukan masukan admin.

export type HajiBreakdown = { components: ComponentBreakdown[]; componentsTotalSellPrice: number }

export async function computeHajiBreakdown(hajiProductId: string): Promise<HajiBreakdown> {
  const { components, totalSellPrice } = await computeCostComponents('haji', hajiProductId)
  return { components, componentsTotalSellPrice: totalSellPrice }
}

// Pembungkus tipis (Fase 1 harga terpadu): harga Haji disimpan mesin `lib/pricing/engine` (titik harga `haji`) dengan penulisan ganda ke `HajiProduct.price`.

/** Dipanggil setiap Komponen Biaya Haji berubah dan dari cron kurs. */
export async function refreshHajiPriceCache(hajiProductId: string): Promise<void> {
  await repriceOwner('haji', hajiProductId)
}

/** Cron kurs: SEMUA produk Haji (termasuk nonaktif — produk yang diaktifkan kembali tidak boleh tampil dengan harga basi); `currencies` = hanya yang biayanya memakai mata uang itu. */
export async function refreshAllHajiPriceCaches(currencies?: string[]): Promise<void> {
  await repriceOwnerType('haji', currencies)
}
