import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { priceOwner } from './owners'
import { lockOwnerPoints } from './lock'
import { toView } from './view'
import type { PriceOwnerType, PriceUnit, PriceView } from './types'

// HARGA MANUAL (docs/arsitektur-harga-terpadu.md §2 I2/I6, §16): admin menetapkan harga jual sendiri; margin default hanyalah saran. Hidup di `price_points`
// (manualSellIdr), diubah HANYA di sini, dan tiap perubahan tercatat di `price_changes`. Hitung-ulang tak pernah menimpanya (modal bergerak, jual tetap, untung ikut).
// Menetapkan jual di bawah modal TIDAK diblokir ("bukan patokan utama") tetapi WAJIB bercatatan (§8.2); selisihnya muncul di Kesehatan Margin.

/** Masukan tak valid / aturan harga dilanggar → 400 di route. */
export class PriceInputError extends Error {
  constructor(message: string) { super(message); this.name = 'PriceInputError' }
}

/** Batas atas harga jual/modal satuan (rupiah): menolak salah ketik (mis. tambahan nol) sebelum sampai ke katalog. Harus < 10^10 — kolom harga lama bertipe Decimal(12,2). */
export const MAX_PRICE_IDR = 5_000_000_000
export const MIN_NOTE_LENGTH = 3

type Tx = Prisma.TransactionClient
type Actor = { byUserId: string }
type PointKey = { ownerType: PriceOwnerType; ownerId: string; variantKey?: string }

const num = (d: Prisma.Decimal | null | undefined): number | null => (d == null ? null : Number(d))

function validAmount(value: number, what: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new PriceInputError(`${what} harus lebih dari 0`)
  if (value > MAX_PRICE_IDR) throw new PriceInputError(`${what} melebihi batas wajar (${MAX_PRICE_IDR.toLocaleString('id-ID')})`)
  return Math.round(value * 100) / 100
}

async function ensureOwner(ownerType: PriceOwnerType, ownerId: string): Promise<void> {
  if ((await priceOwner(ownerType).existing([ownerId])).length === 0) throw new PriceInputError('Produk tidak ditemukan')
}

/** Atur harga jual manual satu varian. Titik harga belum ada → dibuat (jual tanpa modal) hanya untuk varian tunggal ""; varian khusus (tier Visa) harus sudah ada. */
export async function setManualSell(input: PointKey & Actor & { sellIdr: number; note?: string | null }): Promise<PriceView> {
  const { ownerType, ownerId, byUserId } = input
  const variantKey = input.variantKey ?? ''
  const sell = validAmount(input.sellIdr, 'Harga jual')
  const note = input.note?.trim() ? input.note.trim().slice(0, 500) : null
  await ensureOwner(ownerType, ownerId)
  const owner = priceOwner(ownerType)

  const view = await prisma.$transaction(async tx => {
    await lockOwnerPoints(tx, ownerType, ownerId)
    const existing = await tx.pricePoint.findUnique({ where: { ownerType_ownerId_variantKey: { ownerType, ownerId, variantKey } } })
    const creatable = owner.creatableVariants.find(v => v.key === variantKey)
    if (!existing && !creatable) throw new PriceInputError('Rentang/varian harga ini belum ada — simpan tarif modalnya lebih dulu')
    const cost = num(existing?.costIdr)
    if (cost != null && sell < cost && (note?.length ?? 0) < MIN_NOTE_LENGTH) {
      throw new PriceInputError('Harga jual di bawah modal — isi catatan alasannya (mis. promo / negosiasi)')
    }
    const oldSell = num(existing?.sellIdr)
    const data = { manualSellIdr: sell, sellIdr: sell, manualNote: note, manualBy: byUserId, manualAt: new Date() }
    const row = existing
      ? await tx.pricePoint.update({ where: { id: existing.id }, data })
      : await tx.pricePoint.create({ data: { ownerType, ownerId, variantKey, unit: (creatable?.unit ?? owner.unit) as PriceUnit, ...data } })
    await tx.priceChange.create({
      data: { ownerType, ownerId, variantKey, kind: 'manual_set', oldSellIdr: oldSell, newSellIdr: sell, oldCostIdr: cost, newCostIdr: cost, note, byUserId },
    })
    return toView(row)
  })
  return view
}

/** Kembalikan satu varian ke harga otomatis (modal × margin). Tanpa harga otomatis (modal belum diisi) tidak ada tujuan kembali → ditolak. */
export async function clearManualSell(input: PointKey & Actor & { note?: string | null }): Promise<PriceView> {
  const { ownerType, ownerId, byUserId } = input
  const variantKey = input.variantKey ?? ''
  const note = input.note?.trim() ? input.note.trim().slice(0, 500) : null
  await ensureOwner(ownerType, ownerId)
  const owner = priceOwner(ownerType)

  return prisma.$transaction(async tx => {
    await lockOwnerPoints(tx, ownerType, ownerId)
    const existing = await tx.pricePoint.findUnique({ where: { ownerType_ownerId_variantKey: { ownerType, ownerId, variantKey } } })
    if (!existing || existing.manualSellIdr == null) throw new PriceInputError('Harga ini tidak sedang diatur manual')
    if (existing.autoSellIdr == null) throw new PriceInputError('Belum ada harga otomatis untuk kembali (modal belum diisi) — atur harga baru atau isi modal lebih dulu')
    const auto = Number(existing.autoSellIdr)
    const row = await tx.pricePoint.update({ where: { id: existing.id }, data: { manualSellIdr: null, sellIdr: auto, manualNote: null, manualBy: null, manualAt: null } })
    await tx.priceChange.create({
      data: { ownerType, ownerId, variantKey, kind: 'manual_clear', oldSellIdr: num(existing.sellIdr), newSellIdr: auto, oldCostIdr: num(existing.costIdr), newCostIdr: num(existing.costIdr), note, byUserId },
    })
    return toView(row)
  })
}

/**
 * Modal untuk pemilik MANUAL-ONLY (katering, layanan hotel): diisi admin langsung, opsional (null = hapus modal). Pemilik berbasis perhitungan menolak — modalnya
 * milik Komponen Biaya/HPP. Titik harga harus sudah ada (jual lebih dulu), jadi untung selalu punya pasangan jual.
 */
export async function setManualCost(input: PointKey & Actor & { costIdr: number | null; note?: string | null }): Promise<PriceView> {
  const { ownerType, ownerId, byUserId } = input
  const variantKey = input.variantKey ?? ''
  const owner = priceOwner(ownerType)
  if (!owner.manualOnly) throw new PriceInputError('Modal produk ini dihitung dari biaya (HPP) — ubah di editor biayanya')
  const cost = input.costIdr == null ? null : validAmount(input.costIdr, 'Modal')
  await ensureOwner(ownerType, ownerId)
  return prisma.$transaction(async tx => {
    await lockOwnerPoints(tx, ownerType, ownerId)
    const existing = await tx.pricePoint.findUnique({ where: { ownerType_ownerId_variantKey: { ownerType, ownerId, variantKey } } })
    if (!existing) throw new PriceInputError('Atur harga jual lebih dulu, baru modalnya')
    const row = await tx.pricePoint.update({ where: { id: existing.id }, data: { costIdr: cost } })
    await tx.priceChange.create({
      data: { ownerType, ownerId, variantKey, kind: 'cost_set', oldSellIdr: num(existing.sellIdr), newSellIdr: num(existing.sellIdr), oldCostIdr: num(existing.costIdr), newCostIdr: cost, note: input.note?.trim() || null, byUserId },
    })
    return toView(row)
  })
}

export type PriceChangeView = {
  id: string; variantKey: string; kind: string; oldSellIdr: number | null; newSellIdr: number | null
  oldCostIdr: number | null; newCostIdr: number | null; note: string | null; byUserId: string | null; at: Date
}

/** Riwayat terbaru (terbaru dulu). */
export async function listPriceChanges(ownerType: PriceOwnerType, ownerId: string, limit = 20): Promise<PriceChangeView[]> {
  const rows = await prisma.priceChange.findMany({ where: { ownerType, ownerId }, orderBy: [{ at: 'desc' }, { id: 'desc' }], take: Math.min(Math.max(limit, 1), 100) })
  return rows.map(r => ({
    id: r.id, variantKey: r.variantKey, kind: r.kind, oldSellIdr: num(r.oldSellIdr), newSellIdr: num(r.newSellIdr),
    oldCostIdr: num(r.oldCostIdr), newCostIdr: num(r.newCostIdr), note: r.note, byUserId: r.byUserId, at: r.at,
  }))
}

