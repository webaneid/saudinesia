import { prisma } from '@/lib/db'
import { computeSellPrice } from './computeSellPrice'

// Muthowif tidak day-based (docs/arsitektur-muthowif.md §10), tier HPP selalu flat
// [{minDays:0, maxDays:9999, cost}] jadi cocok di hari berapa pun. Bukan angka bisnis.
// Pola identik refreshFlightScheduleCache.ts.
const PROBE_DAY = 1

/**
 * Refresh cache MuthowifServicePrice.price dari ProductCost (komponen "layanan"). Dipanggil
 * setiap kali ProductCost/PreferredVendor/PricingRule untuk singleton ini berubah, dan dari
 * cron kurs setelah nilai tukar di-refresh.
 */
export async function refreshMuthowifServicePriceCache(): Promise<void> {
  const servicePrice = await prisma.muthowifServicePrice.findFirst()
  if (!servicePrice) return

  const result = await computeSellPrice('muthowif', servicePrice.id, PROBE_DAY)
  if (!result || result.hppRupiah <= 0) return // jangan reset ke 0 kalau belum ada komponen HPP valid

  await prisma.muthowifServicePrice.update({
    where: { id: servicePrice.id },
    data: { price: result.sellPrice },
  })
}

export async function refreshAllMuthowifServicePriceCaches(currencies?: string[]): Promise<void> {
  const servicePrice = await prisma.muthowifServicePrice.findFirst()
  if (!servicePrice) return

  if (currencies && currencies.length > 0) {
    const relevant = await prisma.productCost.findFirst({
      where: { productType: 'muthowif', productId: servicePrice.id, isActive: true, currency: { in: currencies } },
    })
    if (!relevant) return
  }

  try {
    await refreshMuthowifServicePriceCache()
  } catch (err) {
    console.error('[refreshAllMuthowifServicePriceCaches] gagal:', err)
  }
}
