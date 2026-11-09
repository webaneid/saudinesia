import { prisma } from '@/lib/db'

// Nama maskapai per jadwal untuk katalog publik (docs/arsitektur-frontend-publik.md §6.7). Maskapai = vendor komponen `tiket` jadwal itu;
// hanya NAMA vendor yang keluar dari sini — halaman publik tidak menyentuh tabel biaya (modal tetap internal, K4).
export async function flightAirlines(scheduleIds: readonly string[]): Promise<Map<string, string>> {
  if (scheduleIds.length === 0) return new Map()
  const rows = await prisma.productCost.findMany({
    where: { productType: 'flight', productId: { in: [...scheduleIds] }, costComponent: 'tiket', isActive: true },
    select: { productId: true, vendor: { select: { name: true } } },
    orderBy: [{ productId: 'asc' }, { id: 'asc' }],
  })
  return new Map(rows.map(r => [r.productId, r.vendor.name]))
}
