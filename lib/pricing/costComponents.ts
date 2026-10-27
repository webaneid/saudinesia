import { prisma } from '@/lib/db'
import { getLatestRate, resolveMarginRule, roundToNearest } from './pricingHelpers'

// Komponen Biaya bebas — satu-satunya tempat baris `ProductCost` diubah menjadi HPP + harga jual PER KOMPONEN
// (docs/arsitektur-komponen-biaya.md). Sebelumnya blok ini ditulis identik di computePackagePrice dan computeTourPackagePrice.

type CostTier = { minDays: number; maxDays: number; cost: number }

// Flat, tidak day-based — sama alasan Flight/Muthowif/Transport/Ziarah (docs/arsitektur-paket-umroh.md §5).
const PROBE_DAY = 1

export type ComponentBreakdown = {
  /** ProductCost.id — kunci baris snapshot harga (nama komponen boleh kembar antar vendor). */
  costId: string
  costComponent: string
  vendorId: string
  currency: string
  hppRupiah: number
  sellPrice: number
  /** ExchangeRate.id yang membentuk HPP (kosong untuk IDR) — jejak untuk mesin harga. */
  rateId?: string
}

export type CostComponentsResult = { components: ComponentBreakdown[]; totalSellPrice: number }

/**
 * HPP (kurs) → margin tipe produk → pembulatan, PER KOMPONEN, lalu dijumlah. Komponen tanpa tier yang cocok atau tanpa kurs dilewati
 * (bukan error total) — perilaku sama dengan implementasi lama.
 */
export async function computeCostComponents(productType: string, productId: string): Promise<CostComponentsResult> {
  const costs = await prisma.productCost.findMany({ where: { productType, productId, isActive: true } })
  const { minMarginPercent, roundingIncrement } = await resolveMarginRule(productType)

  const components: ComponentBreakdown[] = []
  for (const c of costs) {
    const tiers = c.costTiers as unknown as CostTier[]
    const tier = tiers.find(t => PROBE_DAY >= t.minDays && PROBE_DAY <= t.maxDays)
    if (!tier) continue

    let hppRupiah: number
    let rateId: string | undefined
    if (c.currency === 'IDR') {
      hppRupiah = tier.cost
    } else {
      const rate = await getLatestRate(c.currency, 'IDR')
      if (!rate) continue // kurs tidak ditemukan — skip komponen ini, bukan error total
      hppRupiah = tier.cost * Number(rate.sellRate)
      rateId = rate.id
    }

    const sellPrice = roundToNearest(hppRupiah * (1 + minMarginPercent / 100), roundingIncrement)
    components.push({ costId: c.id, costComponent: c.costComponent, vendorId: c.vendorId, currency: c.currency, hppRupiah, sellPrice, rateId })
  }

  return { components, totalSellPrice: components.reduce((sum, c) => sum + c.sellPrice, 0) }
}
