import { prisma } from '@/lib/db'

/**
 * Batch lookup "maskapai" (Vendor.name lewat ProductCost komponen "tiket") untuk sekumpulan
 * FlightSchedule sekaligus — satu query, bukan N+1 per jadwal. Dipakai di listing admin dan
 * katalog publik (docs/arsitektur-tiket-pesawat.md §4, §7, §8).
 */
export async function getFlightAirlineNames(scheduleIds: string[]): Promise<Map<string, string>> {
  if (scheduleIds.length === 0) return new Map()
  const costs = await prisma.productCost.findMany({
    where: { productType: 'flight', productId: { in: scheduleIds }, costComponent: 'tiket', isActive: true },
    include: { vendor: true },
  })
  return new Map(costs.map(c => [c.productId, c.vendor.name]))
}
