import { prisma } from '@/lib/db'
import { getLatestRate, resolveMarginRule, roundToNearest } from './pricingHelpers'

type CostTier = { minDays: number; maxDays: number; cost: number }
type OverridableTier = CostTier & { sellPriceOverride?: number | null }

export type SellPriceResult = {
  hppRupiah: number
  minSellPrice: number
  /** Hasil rumus (HPP × margin, dibulatkan) — TANPA override. `sellPrice` = override ?? ini. Dipakai mesin harga (lib/pricing/engine). */
  autoSellPrice: number
  /** Harga jual manual per tier yang tersimpan di JSON biaya (sumber lama; Fase 3 memindahkannya ke PricePoint). */
  sellPriceOverride: number | null
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
  let sellPriceOverride: number | undefined
  const rateUsed: string[] = []
  const vendorUsed: string[] = []

  for (const component of components) {
    const preferredVendorId = preferredByComponent.get(component.costComponent)
    if (!preferredVendorId || component.vendorId !== preferredVendorId) continue

    const tiers = component.costTiers as unknown as OverridableTier[]
    const tier = findTier(tiers, jumlahHari)
    if (!tier) continue

    // Harga jual manual per tier (docs/arsitektur-harga.md §16, §20) — kalau admin isi override di
    // baris yang cocok dengan jumlahHari, itu jadi harga publish final, menggantikan hasil rounding
    // otomatis. Dicari di komponen HPP MANAPUN yang preferred untuk produk ini (bukan hardcode nama
    // komponen tertentu) — komponen pertama yang punya override menang, biasanya cuma ada 1 per produk.
    if (tier.sellPriceOverride != null && sellPriceOverride === undefined) {
      sellPriceOverride = tier.sellPriceOverride
    }

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

  const { minMarginPercent, roundingIncrement } = await resolveMarginRule(productType)

  // hppRupiah TIDAK ikut di-override — tetap angka asli untuk transparansi.
  const minSellPrice = hppRupiah * (1 + minMarginPercent / 100)
  const autoSellPrice = roundToNearest(minSellPrice, roundingIncrement)
  const sellPrice = sellPriceOverride != null ? sellPriceOverride : autoSellPrice

  return {
    hppRupiah, minSellPrice, autoSellPrice, sellPriceOverride: sellPriceOverride ?? null,
    marginPercentUsed: minMarginPercent, roundingUsed: roundingIncrement, sellPrice, rateUsed, vendorUsed,
  }
}
