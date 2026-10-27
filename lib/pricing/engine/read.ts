import { prisma } from '@/lib/db'
import { ItemNotBookableError } from '@/lib/booking/errors'
import type { PriceOwnerType } from './types'

// PEMBACA TUNGGAL harga jual (invarian I3, docs/arsitektur-harga-terpadu.md §15): katalog, booking, kuota, dan komputasi paket membaca `price_points` lewat
// sini — bukan kolom `*.price` lama. Yang keluar hanya HARGA JUAL (invarian I5); modal/untung hanya lewat `getPricePoint(s)` di service.ts untuk sisi admin.
// Pemilik tanpa titik harga = belum berharga → 0 (tampilan) atau ItemNotBookableError (jalur pesan).

/** Harga jual efektif per id. Varian "" untuk semua pemilik; Visa = TERMURAH di antara tier ("mulai dari"). Id tanpa titik harga tak ada di peta. */
export async function sellPrices(ownerType: PriceOwnerType, ids: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (ids.length === 0) return out
  const rows = await prisma.pricePoint.findMany({
    where: { ownerType, ownerId: { in: [...ids] } },
    select: { ownerId: true, sellIdr: true },
  })
  for (const r of rows) {
    const v = Number(r.sellIdr)
    const prev = out.get(r.ownerId)
    if (prev === undefined || v < prev) out.set(r.ownerId, v)
  }
  return out
}

/** Harga jual satu pemilik; 0 bila belum berharga. */
export async function sellPrice(ownerType: PriceOwnerType, id: string): Promise<number> {
  return (await sellPrices(ownerType, [id])).get(id) ?? 0
}

/**
 * Harga jual untuk JALUR PESAN: tidak ada titik harga atau nilainya ≤ 0 → `ItemNotBookableError` (422). Tidak pernah gratis.
 * `db` boleh klien transaksi agar dibaca konsisten dengan kuota yang sedang ditahan.
 */
export async function requireSellPrice(
  ownerType: PriceOwnerType, id: string, what: string,
  db: Pick<typeof prisma, 'pricePoint'> = prisma,
): Promise<number> {
  const rows = await db.pricePoint.findMany({ where: { ownerType, ownerId: id }, select: { sellIdr: true } })
  const price = rows.length === 0 ? 0 : Math.min(...rows.map(r => Number(r.sellIdr)))
  if (!(price > 0)) throw new ItemNotBookableError(`Harga ${what} belum ditetapkan`)
  return price
}

/** Salin baris + `price` (harga jual, number) dari titik harga — DTO tetap memakai nama `price` agar klien tak berubah. */
export async function withSellPrice<T extends { id: string }>(ownerType: PriceOwnerType, rows: readonly T[]): Promise<Array<T & { price: number }>> {
  const map = await sellPrices(ownerType, rows.map(r => r.id))
  return rows.map(r => ({ ...r, price: map.get(r.id) ?? 0 }))
}

export type VisaFeeRule = { minDays: number; maxDays: number; fee: number }

/** Rentang harga Visa per tier (urut hari awal). Pengganti `VisaProduct.durationFeeRules`. */
export async function visaFeeRules(ids: readonly string[]): Promise<Map<string, VisaFeeRule[]>> {
  const out = new Map<string, VisaFeeRule[]>()
  if (ids.length === 0) return out
  const rows = await prisma.pricePoint.findMany({ where: { ownerType: 'visa', ownerId: { in: [...ids] } }, select: { ownerId: true, variantKey: true, sellIdr: true } })
  for (const r of rows) {
    const m = /^days:(\d+)-(\d+)$/.exec(r.variantKey)
    if (!m) continue
    const list = out.get(r.ownerId) ?? []
    list.push({ minDays: Number(m[1]), maxDays: Number(m[2]), fee: Number(r.sellIdr) })
    out.set(r.ownerId, list)
  }
  for (const list of out.values()) list.sort((a, b) => a.minDays - b.minDays || a.maxDays - b.maxDays)
  return out
}

/** Tarif layanan muthowif (singleton: baris pertama seperti kode lama) + harga jualnya dari titik harga. null bila belum ada barisnya. */
export async function getMuthowifServicePrice(): Promise<{ id: string; price: number } | null> {
  const row = await prisma.muthowifServicePrice.findFirst({ select: { id: true } })
  return row ? { id: row.id, price: await sellPrice('muthowif', row.id) } : null
}

/** Ringkasan harga Visa untuk katalog: `from` = termurah ("mulai dari"), `isRange` = ada ≥ 2 harga BERBEDA di antara tier. Tanpa titik harga: from 0, bukan rentang. */
export async function visaPriceSummary(ids: readonly string[]): Promise<Map<string, { from: number; isRange: boolean }>> {
  const rules = await visaFeeRules(ids)
  const out = new Map<string, { from: number; isRange: boolean }>()
  for (const id of ids) {
    const fees = (rules.get(id) ?? []).map(r => r.fee)
    out.set(id, { from: fees.length ? Math.min(...fees) : 0, isRange: new Set(fees).size >= 2 })
  }
  return out
}
