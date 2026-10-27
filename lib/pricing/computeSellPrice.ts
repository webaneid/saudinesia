import { prisma } from '@/lib/db'
import { getLatestRate, resolveMarginRule, roundToNearest } from './pricingHelpers'

type CostTier = { minDays: number; maxDays: number; cost: number }

export type SellPriceResult = {
  hppRupiah: number
  minSellPrice: number
  /** Hasil rumus (HPP × margin, dibulatkan). Harga jual manual TIDAK dikenal di sini — itu milik titik harga (lib/pricing/engine, Fase 3). */
  autoSellPrice: number
  marginPercentUsed: number
  roundingUsed: number
  sellPrice: number
  rateUsed: string[]   // ExchangeRate.id per komponen yang berkontribusi
  vendorUsed: string[] // Vendor.id per komponen yang berkontribusi
}

function findTier<T extends { minDays: number; maxDays: number }>(tiers: T[], days: number): T | undefined {
  return tiers.find(t => days >= t.minDays && days <= t.maxDays)
}

/**
 * Hitung harga jual dari HPP + kurs + margin untuk satu produk pada satu jumlah hari.
 * Lihat docs/arsitektur-harga.md §5 untuk desain lengkap.
 *
 * Komponen tanpa tier yang cocok untuk `jumlahHari` dilewati (tidak berkontribusi ke HPP) —
 * bukan error, karena satu komponen memang boleh hanya berlaku untuk rentang hari tertentu
 * (mis. "biaya_non_hotel" cuma relevan untuk 20-30 hari).
 */
export async function computeSellPrice(
  productType: string,
  productId: string,
  jumlahHari: number,
): Promise<SellPriceResult | null> {
  const components = await prisma.productCost.findMany({
    where: { productType, productId, isActive: true },
  })

  const preferredVendors = await prisma.preferredVendor.findMany({
    where: { productType, productId },
  })
  const preferredByComponent = new Map(preferredVendors.map(pv => [pv.costComponent, pv.vendorId]))

  let hppRupiah = 0
  const rateUsed: string[] = []
  const vendorUsed: string[] = []

  for (const component of components) {
    const preferredVendorId = preferredByComponent.get(component.costComponent)
    if (!preferredVendorId || component.vendorId !== preferredVendorId) continue

    const tiers = component.costTiers as unknown as CostTier[]
    const tier = findTier(tiers, jumlahHari)
    if (!tier) continue

    // Biaya sudah dalam Rupiah — tidak butuh konversi kurs, dan ExchangeRate IDR->IDR memang
    // tidak pernah ada (cron kurs cuma fetch USD/IDR & SAR/IDR). Lihat docs/arsitektur-harga.md §19.
    if (component.currency === 'IDR') {
      hppRupiah += tier.cost
      vendorUsed.push(component.vendorId)
      continue
    }

    const rate = await getLatestRate(component.currency, 'IDR')
    if (!rate) {
      console.error(`[computeSellPrice] Tidak ada ExchangeRate untuk ${component.currency}->IDR`)
      continue
    }

    hppRupiah += tier.cost * Number(rate.sellRate)
    rateUsed.push(rate.id)
    vendorUsed.push(component.vendorId)
  }

  const { defaultMarginPercent, roundingIncrement } = await resolveMarginRule(productType)

  const minSellPrice = hppRupiah * (1 + defaultMarginPercent / 100)
  const autoSellPrice = roundToNearest(minSellPrice, roundingIncrement)
  const sellPrice = autoSellPrice

  return {
    hppRupiah, minSellPrice, autoSellPrice,
    marginPercentUsed: defaultMarginPercent, roundingUsed: roundingIncrement, sellPrice, rateUsed, vendorUsed,
  }
}
