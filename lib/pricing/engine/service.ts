import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { PRICE_OWNER_TYPES, priceOwner } from './owners'
import { lockOwnerPoints } from './lock'
import { toView } from './view'
import type { PriceOwnerType, PriceView, PriceUnit, ResolvedVariant, StoredVariant } from './types'

// SATU-SATUNYA penulis tabel `price_points` (invarian I3, docs/arsitektur-harga-terpadu.md). Menulis ganda ke kolom harga lama (dihapus di Fase 5).
// Dipanggil lewat pembungkus lama (`refresh*Cache`) dan `refreshAllPricingCaches` agar semua pemicu yang ada (biaya berubah, kurs, margin) tetap sama.

const num = (d: Prisma.Decimal | null): number | null => (d == null ? null : Number(d))

/**
 * Hitung ulang SEMUA varian satu pemilik dari modalnya, simpan ke `price_points`, tulis ganda ke kolom lama — satu transaksi.
 *  - Modal ada → modal & harga otomatis diperbarui; harga manual (bila ada) tetap menang atas otomatis.
 *  - Modal hilang/kosong → harga yang ada DIPERTAHANKAN dan modal ditandai kosong (null) — tak pernah direset ke 0, tak pernah diam-diam basi tanpa tanda.
 *  - Belum ada titik harga + modal kosong + kolom lama berisi harga > 0 → harga lama dipungut sebagai titik (modal null): "jual tanpa modal".
 *  - Pemilik sudah dihapus → titik harganya dibersihkan.
 */
export async function repriceOwner(ownerType: PriceOwnerType, ownerId: string): Promise<void> {
  const owner = priceOwner(ownerType)
  if ((await owner.existing([ownerId])).length === 0) {
    await prisma.pricePoint.deleteMany({ where: { ownerType, ownerId } })
    return
  }
  if (owner.manualOnly) return // harga diisi admin (PriceCard) — tak ada yang dihitung dari modal
  const resolved = await owner.resolve(ownerId)
  const legacy = resolved.some(v => v.autoSellIdr == null) ? await owner.adoptLegacy(ownerId) : null

  await prisma.$transaction(async tx => {
    await lockOwnerPoints(tx, ownerType, ownerId) // serialkan dengan perubahan harga manual (jangan menimpa nilai yang baru commit)
    const existing = new Map((await tx.pricePoint.findMany({ where: { ownerType, ownerId } })).map(p => [p.variantKey, p]))
    const stored: StoredVariant[] = []

    for (const v of resolved) {
      const ex = existing.get(v.variantKey)
      let auto: number | null
      let cost: number | null
      if (v.autoSellIdr != null) { auto = v.autoSellIdr; cost = v.costIdr }
      else if (ex) { auto = num(ex.autoSellIdr); cost = null }
      else if (legacy != null && legacy > 0 && v.variantKey === '') { auto = legacy; cost = null }
      else continue // tak ada modal dan tak ada harga untuk dipertahankan → tak ada titik harga

      const manual = v.manualSellIdr !== undefined ? v.manualSellIdr : num(ex?.manualSellIdr ?? null)
      const sell = manual ?? auto
      if (sell == null) continue

      const data = {
        unit: v.unit, costIdr: cost, autoSellIdr: auto, manualSellIdr: manual, sellIdr: sell,
        // Jejak aturan/kurs/vendor hanya diperbarui saat benar-benar dihitung dari modal; selain itu jejak terakhir dipertahankan.
        ...(v.autoSellIdr != null
          ? { marginPctUsed: v.marginPctUsed, roundingUsed: v.roundingUsed, fxRateIds: v.fxRateIds, vendorIds: v.vendorIds }
          : {}),
        computedAt: new Date(),
      }
      await tx.pricePoint.upsert({
        where: { ownerType_ownerId_variantKey: { ownerType, ownerId, variantKey: v.variantKey } },
        create: { ownerType, ownerId, variantKey: v.variantKey, ...data },
        update: data,
      })
      stored.push({ variantKey: v.variantKey, sellIdr: sell, costIdr: cost })
    }

    if (owner.prunes) {
      const keep = new Set(resolved.map(v => v.variantKey))
      await tx.pricePoint.deleteMany({ where: { ownerType, ownerId, variantKey: { notIn: [...keep] } } })
    }
    await owner.writeLegacy(tx, ownerId, stored)
  })
}

/** Id pemilik yang punya biaya bermata uang dalam `currencies` (cron kurs hanya menyegarkan yang terdampak). */
async function idsUsingCurrencies(ownerType: PriceOwnerType, ids: string[], currencies: string[]): Promise<Set<string>> {
  const rows = await prisma.productCost.findMany({
    where: { productType: ownerType, productId: { in: ids }, isActive: true, currency: { in: currencies } },
    select: { productId: true }, distinct: ['productId'],
  })
  return new Set(rows.map(r => r.productId))
}

/**
 * Hitung ulang semua pemilik satu tipe. `currencies` diberikan = hanya yang biayanya memakai mata uang itu (pemilik yang membaca titik harga modul lain — paket — selalu ikut: modal bagian sub-modul
 * bisa bergeser walau komponennya tak berubah). Satu id gagal tidak menghentikan yang lain; mengembalikan true bila ada yang gagal.
 */
export async function repriceOwnerType(ownerType: PriceOwnerType, currencies?: string[]): Promise<boolean> {
  const owner = priceOwner(ownerType)
  if (owner.manualOnly) return false
  let ids = await owner.listIds()
  if (currencies && currencies.length > 0 && !owner.dependsOnOthers) {
    const hit = await idsUsingCurrencies(ownerType, ids, currencies)
    ids = ids.filter(id => hit.has(id))
  }
  let failed = false
  for (const id of ids) {
    try { await repriceOwner(ownerType, id) } catch (err) {
      failed = true
      console.error(`[pricing] hitung ulang ${ownerType} ${id} gagal:`, err)
    }
  }
  return failed
}

/** Hapus titik harga yatim (pemilik sudah tak ada — mis. terhapus berantai bersama induknya). Mengembalikan jumlah baris dihapus. */
export async function sweepOrphanPricePoints(): Promise<number> {
  let removed = 0
  for (const ownerType of PRICE_OWNER_TYPES) {
    const owner = priceOwner(ownerType)
    const rows = await prisma.pricePoint.findMany({ where: { ownerType }, select: { ownerId: true }, distinct: ['ownerId'] })
    if (rows.length === 0) continue
    const ids = rows.map(r => r.ownerId)
    const alive = new Set(await owner.existing(ids))
    const dead = ids.filter(id => !alive.has(id))
    if (dead.length > 0) removed += (await prisma.pricePoint.deleteMany({ where: { ownerType, ownerId: { in: dead } } })).count
  }
  return removed
}

/**
 * Hitung ulang SEMUA pemilik (dasar dulu, komposit terakhir). Dipakai cron kurs (`currencies`) dan perubahan aturan margin (semua).
 * Mengembalikan tipe pemilik yang ada kegagalannya.
 */
export async function repriceAll(currencies?: string[]): Promise<string[]> {
  const failed: string[] = []
  for (const ownerType of PRICE_OWNER_TYPES) {
    try { if (await repriceOwnerType(ownerType, currencies)) failed.push(ownerType) } catch (err) {
      failed.push(ownerType)
      console.error(`[pricing] hitung ulang ${ownerType} gagal:`, err)
    }
  }
  try { await sweepOrphanPricePoints() } catch (err) { console.error('[pricing] sapu titik harga yatim gagal:', err) }
  return failed
}


/** Pembaca tunggal: semua varian satu pemilik (modal/jual/untung). Hanya untuk sisi admin — harga publik cukup `sellIdr` (invarian I5). */
export async function getPricePoints(ownerType: PriceOwnerType, ownerId: string): Promise<PriceView[]> {
  const rows = await prisma.pricePoint.findMany({ where: { ownerType, ownerId }, orderBy: { variantKey: 'asc' } })
  return rows.map(toView)
}

export async function getPricePoint(ownerType: PriceOwnerType, ownerId: string, variantKey = ''): Promise<PriceView | null> {
  const p = await prisma.pricePoint.findUnique({ where: { ownerType_ownerId_variantKey: { ownerType, ownerId, variantKey } } })
  return p ? toView(p) : null
}

export type { ResolvedVariant }
