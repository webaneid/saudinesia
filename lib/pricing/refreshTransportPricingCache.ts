import { prisma } from '@/lib/db'
import { computeSellPrice } from './computeSellPrice'

// Transport tidak day-based (docs/arsitektur-transportasi.md §9.4), tier HPP selalu flat
// [{minDays:0, maxDays:9999, cost}] jadi cocok di hari berapa pun. Bukan angka bisnis.
// Pola identik refreshFlightScheduleCache.ts.
const PROBE_DAY = 1

/**
 * Refresh cache TransportPricing.price dari ProductCost (komponen "kendaraan") kombinasi
 * rute×kendaraan ini. Dipanggil setiap kali ProductCost/PreferredVendor/PricingRule untuk
 * pricing ini berubah, dan dari refreshAllTransportPricingCaches() setelah cron kurs jalan.
 */
export async function refreshTransportPricingCache(pricingId: string): Promise<void> {
  const result = await computeSellPrice('transport', pricingId, PROBE_DAY)
  if (!result || result.hppRupiah <= 0) return // jangan reset ke 0 kalau belum ada komponen HPP valid

  await prisma.transportPricing.update({
    where: { id: pricingId },
    data: { price: result.sellPrice },
  })
}

/**
 * Refresh semua TransportPricing aktif. Kalau `currencies` diberikan (dipanggil dari cron
 * kurs), hanya pricing yang komponen HPP-nya pakai currency itu yang di-refresh.
 */
export async function refreshAllTransportPricingCaches(currencies?: string[]): Promise<void> {
  const pricings = await prisma.transportPricing.findMany({ where: { isActive: true }, select: { id: true } })

  for (const p of pricings) {
    if (currencies && currencies.length > 0) {
      const relevant = await prisma.productCost.findFirst({
        where: { productType: 'transport', productId: p.id, isActive: true, currency: { in: currencies } },
      })
      if (!relevant) continue
    }
    try {
      await refreshTransportPricingCache(p.id)
    } catch (err) {
      console.error(`[refreshAllTransportPricingCaches] gagal untuk pricing ${p.id}:`, err)
    }
  }
}
