import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { PILGRIM_DATA_OWNERS, productRefKey, type PilgrimDataOwner, type ProductRef } from './owners'

// Saklar "minta data jamaah" per produk (docs/arsitektur-data-jamaah.md §3.2) — pembaca + penulis tunggal (D3, `setPilgrimDataEnabled`); baris dibersihkan
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

// ── Penulis saklar (D3) ─────────────────────────────────────────────────────────────────────────────────────────────

/** Tabel produk tiap pemilik — identifier TETAP dari kode (bukan masukan), dipakai mengunci baris produk saat saklar ditulis. */
const OWNER_TABLE: Record<PilgrimDataOwner, string> = {
  visa: 'visa_products', package: 'packages', haji: 'haji_products', tour_package: 'tour_packages', hotel: 'hotels',
  transport: 'transport_trips', flight: 'flight_schedules', catering: 'catering_options', muthowif: 'muthowif_service_price',
}

export type PilgrimDataState = { enabled: boolean; defaultEnabled: boolean; stored: boolean }

/** Keadaan saklar satu produk (null = produk tidak ada). */
export async function pilgrimDataState(ref: ProductRef, db: Db = prisma): Promise<PilgrimDataState | null> {
  if (!(await productExists(db, ref))) return null
  const row = await db.productPilgrimData.findUnique({ where: { productType_productId: ref }, select: { enabled: true } })
  const defaultEnabled = PILGRIM_DATA_OWNERS[ref.productType].defaultEnabled
  return { enabled: row?.enabled ?? defaultEnabled, defaultEnabled, stored: !!row }
}

async function productExists(db: Db, ref: ProductRef, lock = false): Promise<boolean> {
  // $queryRawUnsafe: nama tabel dari peta tetap di atas (Prisma tak bisa memilih model dinamis + FOR SHARE); id selalu parameter.
  const rows = await db.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "${OWNER_TABLE[ref.productType]}" WHERE "id" = $1${lock ? ' FOR SHARE' : ''}`, ref.productId)
  return rows.length > 0
}

/**
 * SATU-SATUNYA penulis `product_pilgrim_data` selain pembersih saat produk dihapus. Baris produk dikunci FOR SHARE dulu, jadi saklar tak pernah
 * tertulis untuk produk yang sudah dihapus. Balapan sempit yang tersisa (penghapus sudah membersihkan saklar lalu menunggu kunci ini) hanya
 * meninggalkan baris yatim berkunci uuid yang tak pernah dibaca lagi — diterima. Nilai selalu disimpan eksplisit.
 */
export async function setPilgrimDataEnabled(ref: ProductRef, enabled: boolean): Promise<PilgrimDataState | null> {
  return prisma.$transaction(async (tx) => {
    if (!(await productExists(tx, ref, true))) return null
    await tx.productPilgrimData.upsert({
      where: { productType_productId: ref },
      create: { ...ref, enabled },
      update: { enabled },
    })
    return { enabled, defaultEnabled: PILGRIM_DATA_OWNERS[ref.productType].defaultEnabled, stored: true }
  })
}
