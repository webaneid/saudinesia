import { prisma } from '@/lib/db'
import { computeCostComponents, type ComponentBreakdown } from './costComponents'

// Harga Haji = jumlah harga jual PER KOMPONEN dari Komponen Biaya (docs/arsitektur-komponen-biaya.md §3.1, §3.3) — margin tipe `haji`
// (`PricingRule`), jatuh ke aturan global bila belum ada. `HajiProduct.price` hanyalah cache hasil ini, bukan masukan admin.

export type HajiBreakdown = { components: ComponentBreakdown[]; componentsTotalSellPrice: number }

export async function computeHajiBreakdown(hajiProductId: string): Promise<HajiBreakdown> {
  const { components, totalSellPrice } = await computeCostComponents('haji', hajiProductId)
  return { components, componentsTotalSellPrice: totalSellPrice }
}

/** Refresh cache `HajiProduct.price` — dipanggil setiap Komponen Biaya Haji berubah dan dari cron kurs. */
export async function refreshHajiPriceCache(hajiProductId: string): Promise<void> {
  const breakdown = await computeHajiBreakdown(hajiProductId)
  await prisma.hajiProduct.update({ where: { id: hajiProductId }, data: { price: breakdown.componentsTotalSellPrice } })
}

/**
 * Cron kurs: hitung ulang cache semua produk Haji yang punya komponen bermata uang yang kursnya baru berubah. SEMUA produk (termasuk yang
 * nonaktif) dihitung ulang — produk yang diaktifkan kembali tidak boleh tampil dengan harga basi.
 */
export async function refreshAllHajiPriceCaches(currencies?: string[]): Promise<void> {
  const products = await prisma.hajiProduct.findMany({ select: { id: true } })

  for (const p of products) {
    if (currencies && currencies.length > 0) {
      const relevant = await prisma.productCost.findFirst({
        where: { productType: 'haji', productId: p.id, isActive: true, currency: { in: currencies } },
      })
      if (!relevant) continue
    }
    try {
      await refreshHajiPriceCache(p.id)
    } catch (err) {
      console.error(`[refreshAllHajiPriceCaches] gagal untuk produk ${p.id}:`, err)
    }
  }
}
