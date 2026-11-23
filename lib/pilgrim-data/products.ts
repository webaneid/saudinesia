import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { PILGRIM_DATA_OWNERS, productRefKey, type ProductRef } from './owners'

// Saklar "minta data jamaah" per produk (docs/arsitektur-data-jamaah.md §3.2) — pembaca. Penulis saklar menyusul di D3; baris dibersihkan
// penghapus produk (lib/admin/productDelete.ts `dropPolymorphic`, lib/haji/delete.ts, trip/jadwal pesawat/katering).

type Db = typeof prisma | Prisma.TransactionClient

/** Kunci `productType:productId` dari `refs` yang saklarnya NYALA (baris tersimpan, atau bawaan jenisnya bila tak ada baris). */
export async function enabledProducts(db: Db, refs: readonly ProductRef[]): Promise<Set<string>> {
  if (refs.length === 0) return new Set()
  const rows = await db.productPilgrimData.findMany({
    where: { OR: refs.map(r => ({ productType: r.productType, productId: r.productId })) },
    select: { productType: true, productId: true, enabled: true },
  })
  const stored = new Map(rows.map(r => [productRefKey(r), r.enabled]))
  return new Set(refs.filter(r => stored.get(productRefKey(r)) ?? PILGRIM_DATA_OWNERS[r.productType].defaultEnabled).map(productRefKey))
}
