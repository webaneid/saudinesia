import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

// Integritas rujukan vendor (ADR-0003 poin 4). SATU-SATUNYA pemeriksaan "vendor ada dan aktif" untuk semua route yang menyimpan `vendorId`,
// dan satu-satunya penghitung "dipakai di mana" untuk keputusan hapus/nonaktif.

type Db = Pick<Prisma.TransactionClient, 'vendor'>

export class VendorNotUsableError extends Error {
  constructor(public readonly reason: 'not_found' | 'inactive', message: string) {
    super(message)
    this.name = 'VendorNotUsableError'
  }
}

/** Vendor harus ada dan aktif untuk dirujuk komponen biaya/vendor pilihan baru. Melempar `VendorNotUsableError` (route memetakannya ke 400). */
export async function assertVendorUsable(vendorId: string, db: Db = prisma): Promise<void> {
  const vendor = await db.vendor.findUnique({ where: { id: vendorId }, select: { isActive: true } })
  if (!vendor) throw new VendorNotUsableError('not_found', 'Vendor tidak ditemukan')
  if (!vendor.isActive) throw new VendorNotUsableError('inactive', 'Vendor nonaktif — aktifkan dulu di menu Vendor atau pilih vendor lain')
}

export type VendorUsage = {
  costsByType: Record<string, number> // ProductCost per productType (package, tour_package, haji, visa, flight, hotel, transport, muthowif)
  costs: number
  preferred: number                   // PreferredVendor
  snapshots: number                   // PriceSnapshot.vendorIds (riwayat harga beku; membuat vendor tak boleh dihapus keras)
  total: number
}

export async function getVendorUsage(vendorId: string): Promise<VendorUsage> {
  const [grouped, preferred, snapshots] = await Promise.all([
    prisma.productCost.groupBy({ by: ['productType'], where: { vendorId }, _count: { _all: true } }),
    prisma.preferredVendor.count({ where: { vendorId } }),
    prisma.priceSnapshot.count({ where: { vendorIds: { array_contains: [vendorId] } } }),
  ])
  const costsByType = Object.fromEntries(grouped.map(g => [g.productType, g._count._all]))
  const costs = grouped.reduce((sum, g) => sum + g._count._all, 0)
  return { costsByType, costs, preferred, snapshots, total: costs + preferred + snapshots }
}
