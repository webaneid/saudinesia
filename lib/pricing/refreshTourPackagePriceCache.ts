import { prisma } from '@/lib/db'
import { computeTourPackageBreakdown, cheapestTotal } from './computeTourPackagePrice'

/**
 * Refresh cache TourPackage.price ("mulai dari") — dipanggil setiap kali ProductCost/
 * PreferredVendor/PricingRule untuk paket ini berubah, dan dari cron kurs.
 */
export async function refreshTourPackagePriceCache(tourPackageId: string): Promise<void> {
  const breakdown = await computeTourPackageBreakdown(tourPackageId)
  const price = cheapestTotal(breakdown)
  await prisma.tourPackage.update({ where: { id: tourPackageId }, data: { price } })
}

export async function refreshAllTourPackagePriceCaches(currencies?: string[]): Promise<void> {
  const packages = await prisma.tourPackage.findMany({ where: { isActive: true }, select: { id: true } })

  for (const p of packages) {
    if (currencies && currencies.length > 0) {
      const relevant = await prisma.productCost.findFirst({
        where: { productType: 'tour_package', productId: p.id, isActive: true, currency: { in: currencies } },
      })
      if (!relevant) continue
    }
    try {
      await refreshTourPackagePriceCache(p.id)
    } catch (err) {
      console.error(`[refreshAllTourPackagePriceCaches] gagal untuk paket ${p.id}:`, err)
    }
  }
}
