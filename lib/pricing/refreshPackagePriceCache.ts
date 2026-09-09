import { prisma } from '@/lib/db'
import { computePackageBreakdown, baseTotal } from './computePackagePrice'

/**
 * Refresh cache Package.price ("mulai dari") — dipanggil setiap kali field yang mempengaruhi
 * harga berubah (semua *Mode/included*Id, Komponen Biaya custom CRUD), dan dari cron kurs.
 */
export async function refreshPackagePriceCache(packageId: string): Promise<void> {
  const breakdown = await computePackageBreakdown(packageId)
  const price = baseTotal(breakdown)
  await prisma.package.update({ where: { id: packageId }, data: { price } })
}

export async function refreshAllPackagePriceCaches(currencies?: string[]): Promise<void> {
  const packages = await prisma.package.findMany({ where: { isActive: true }, select: { id: true } })

  for (const p of packages) {
    if (currencies && currencies.length > 0) {
      const relevant = await prisma.productCost.findFirst({
        where: { productType: 'package', productId: p.id, isActive: true, currency: { in: currencies } },
      })
      if (!relevant) continue
    }
    try {
      await refreshPackagePriceCache(p.id)
    } catch (err) {
      console.error(`[refreshAllPackagePriceCaches] gagal untuk paket ${p.id}:`, err)
    }
  }
}
