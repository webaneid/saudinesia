import { prisma } from '@/lib/db'
import type { PriceOwnerType } from './types'

// Pembaca KHUSUS ADMIN untuk daftar produk (docs/arsitektur-harga-terpadu.md §6, §16): harga jual + modal + untung per baris. Memuat modal/untung — pemanggil WAJIB
// memastikan peran lewat lib/pricing/policy.ts (`canViewCost`) sebelum menyertakannya; yang keluar ke publik hanya `read.ts` (harga jual).
// Bila produk punya beberapa varian (tier Visa) yang diambil adalah varian TERMURAH ("mulai dari"), konsisten dengan katalog.

export type AdminPriceFields = { price: number; costIdr: number | null; profitIdr: number | null; marginPct: number | null }

export async function withAdminPrices<T extends { id: string }>(ownerType: PriceOwnerType, rows: readonly T[], opts: { includeCost: boolean }): Promise<Array<T & AdminPriceFields>> {
  const points = rows.length === 0 ? [] : await prisma.pricePoint.findMany({
    where: { ownerType, ownerId: { in: rows.map(r => r.id) } },
    select: { ownerId: true, variantKey: true, sellIdr: true, costIdr: true },
    orderBy: [{ sellIdr: 'asc' }, { variantKey: 'asc' }],
  })
  const cheapest = new Map<string, (typeof points)[number]>()
  for (const p of points) if (!cheapest.has(p.ownerId)) cheapest.set(p.ownerId, p)
  return rows.map(r => {
    const p = cheapest.get(r.id)
    const sell = p ? Number(p.sellIdr) : 0
    const cost = opts.includeCost && p?.costIdr != null ? Number(p.costIdr) : null
    return {
      ...r, price: sell, costIdr: cost,
      profitIdr: cost == null ? null : sell - cost,
      marginPct: cost == null || cost <= 0 ? null : ((sell - cost) / cost) * 100,
    }
  })
}
