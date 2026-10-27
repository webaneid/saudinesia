import { computeCostComponents, type ComponentBreakdown } from './costComponents'

// Harga Haji = jumlah harga jual PER KOMPONEN dari Komponen Biaya (docs/arsitektur-komponen-biaya.md §3.1, §3.3) — margin tipe `haji`
// (`PricingRule`), jatuh ke aturan global bila belum ada. Harga tersimpan sebagai titik harga `haji` (mesin `lib/pricing/engine`).

export type HajiBreakdown = { components: ComponentBreakdown[]; componentsTotalSellPrice: number }

export async function computeHajiBreakdown(hajiProductId: string): Promise<HajiBreakdown> {
  const { components, totalSellPrice } = await computeCostComponents('haji', hajiProductId)
  return { components, componentsTotalSellPrice: totalSellPrice }
}
