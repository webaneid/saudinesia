import type { Prisma } from '@prisma/client'
import { ItemNotBookableError } from '@/lib/booking/errors'
import { computeCostComponents } from '../costComponents'
import type { PriceOwnerType, PriceUnit } from './types'

// SNAPSHOT HARGA (docs/arsitektur-harga-terpadu.md §17, invarian I4): harga dibekukan saat dipesan. Modul ini adalah SATU-SATUNYA pembaca titik harga untuk jalur pesan
// dan SATU-SATUNYA penulis `price_snapshots`; bacaan yang membentuk harga item booking dan bacaan yang dibekukan adalah bacaan YANG SAMA (tak mungkin selisih).
// Semua fungsi menerima klien transaksi agar dibaca konsisten dengan kuota yang sedang ditahan. Uang dihitung dalam sen bulat (tanpa derau float).

type Db = Pick<Prisma.TransactionClient, 'pricePoint' | 'priceSnapshot'>

/** Titik harga seperti terbaca saat memesan. */
export type TakenPoint = {
  ownerType: PriceOwnerType
  ownerId: string
  variantKey: string
  unit: PriceUnit
  sellIdr: number
  costIdr: number | null
  mode: 'auto' | 'manual'
  fxRateIds: string[]
  vendorIds: string[]
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** Titik harga persis (ownerType, ownerId, variantKey) atau null. Tidak memeriksa nilai. */
export async function readPoint(db: Db, ownerType: PriceOwnerType, ownerId: string, variantKey = ''): Promise<TakenPoint | null> {
  const p = await db.pricePoint.findUnique({ where: { ownerType_ownerId_variantKey: { ownerType, ownerId, variantKey } } })
  if (!p) return null
  return {
    ownerType, ownerId, variantKey, unit: p.unit as PriceUnit,
    sellIdr: Number(p.sellIdr), costIdr: p.costIdr == null ? null : Number(p.costIdr),
    mode: p.manualSellIdr != null ? 'manual' : 'auto',
    fxRateIds: strings(p.fxRateIds), vendorIds: strings(p.vendorIds),
  }
}

/** Seperti `readPoint` tetapi untuk JALUR PESAN: tak ada titik atau jual ≤ 0 → `ItemNotBookableError` (422). Tak pernah gratis. */
export async function takePoint(db: Db, ownerType: PriceOwnerType, ownerId: string, variantKey: string, what: string): Promise<TakenPoint> {
  const p = await readPoint(db, ownerType, ownerId, variantKey)
  if (!p || !(p.sellIdr > 0)) throw new ItemNotBookableError(`Harga ${what} belum ditetapkan`)
  return p
}

/**
 * Tier Visa yang memuat `days` hari (varian `days:min-max`). Tak ada tier yang cocok, atau jualnya ≤ 0 → `ItemNotBookableError`: Visa tak pernah terjual gratis
 * hanya karena lama tinggal di luar rentang mana pun (dulu lolos Rp 0).
 */
export async function takeVisaTier(db: Db, visaProductId: string, days: number, what = 'visa'): Promise<TakenPoint> {
  const rows = await db.pricePoint.findMany({ where: { ownerType: 'visa', ownerId: visaProductId }, select: { variantKey: true } })
  const hit = rows
    .map(r => ({ key: r.variantKey, m: /^days:(\d+)-(\d+)$/.exec(r.variantKey) }))
    .filter((r): r is { key: string; m: RegExpExecArray } => r.m !== null)
    .filter(r => days >= Number(r.m[1]) && days <= Number(r.m[2]))
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]) || a.key.localeCompare(b.key))[0]
  if (!hit) throw new ItemNotBookableError(`Harga ${what} untuk ${days} hari belum ditetapkan`)
  return takePoint(db, 'visa', visaProductId, hit.key, what)
}

/** Modal titik harga sub-modul (null = tidak ada / belum lengkap). */
export async function peekCost(db: Db, ownerType: PriceOwnerType, ownerId: string, variantKey = ''): Promise<number | null> {
  return (await readPoint(db, ownerType, ownerId, variantKey))?.costIdr ?? null
}

// ── baris ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type SnapshotLine = {
  lineKey: string
  description: string
  qty: number
  unit: string
  unitCostIdr: number | null
  unitSellIdr: number
  mode: 'auto' | 'manual'
  ref: { ownerType: PriceOwnerType; ownerId: string; variantKey: string } | null
  fxRateIds: string[]
  vendorIds: string[]
}

const cents = (x: number): number => Math.round(x * 100)
/** satuan × jumlah → sen bulat. */
const lineCents = (unit: number, qty: number): number => Math.round(cents(unit) * qty)

export const lineTotalSell = (l: SnapshotLine): number => lineCents(l.unitSellIdr, l.qty) / 100
export const lineTotalCost = (l: SnapshotLine): number | null => (l.unitCostIdr == null ? null : lineCents(l.unitCostIdr, l.qty) / 100)
/** Σ jual baris (rupiah). */
export const sumSell = (lines: readonly SnapshotLine[]): number => lines.reduce((s, l) => s + lineCents(l.unitSellIdr, l.qty), 0) / 100

export function lineFromPoint(p: TakenPoint, o: { lineKey?: string; description: string; qty: number; unit?: string }): SnapshotLine {
  return {
    lineKey: o.lineKey ?? 'main', description: o.description, qty: o.qty, unit: o.unit ?? p.unit,
    unitCostIdr: p.costIdr, unitSellIdr: p.sellIdr, mode: p.mode,
    ref: { ownerType: p.ownerType, ownerId: p.ownerId, variantKey: p.variantKey },
    fxRateIds: p.fxRateIds, vendorIds: p.vendorIds,
  }
}

/** Bagian sub-modul yang ikut harga dasar paket (hotel/kendaraan `included`): jual tersimpan di paket, modal dari titik harga sub-modul bila ada. */
export type CompositePart = { lineKey: string; description: string; qty: number; unit: PriceUnit; unitSellIdr: number; unitCostIdr: number | null; ref: SnapshotLine['ref'] }

/**
 * Baris untuk produk KOMPOSIT (Paket Ziarah, Haji): harga dasar = JUAL TITIK HARGA pemiliknya (harga manual menang). Terurai menjadi satu baris per Komponen Biaya
 * (modal = HPP, jual = jual komponen), satu per bagian `included`, ditambah baris `penyesuaian` = jual titik − Σ baris (tak ditulis bila 0) sehingga Σ baris SELALU = jual titik × pengali.
 * `multiplier` = jumlah satuan yang dibeli (Haji: orang; paket ziarah: 1 — harga per paket).
 * Titik harga tak ada → `ItemNotBookableError`. Jual titik 0 diizinkan (paket yang seluruhnya pilihan pilgrim); pemanggil menolak item bertotal 0.
 */
export async function compositeLines(db: Db, o: { ownerType: 'tour_package' | 'haji'; ownerId: string; /** untuk pesan galat: "Harga {what} belum ditetapkan" */ what: string; /** judul baris bila seluruh harga berupa satu penyesuaian */ label: string; multiplier: number; parts?: CompositePart[] }): Promise<SnapshotLine[]> {
  const point = await readPoint(db, o.ownerType, o.ownerId, '')
  if (!point) throw new ItemNotBookableError(`Harga ${o.what} belum ditetapkan`)
  const { components } = await computeCostComponents(o.ownerType, o.ownerId)

  const lines: SnapshotLine[] = components.map(c => ({
    lineKey: `komponen:${c.costId}`, description: c.costComponent, qty: o.multiplier, unit: 'package',
    unitCostIdr: c.hppRupiah, unitSellIdr: c.sellPrice, mode: 'auto' as const,
    ref: null, fxRateIds: c.rateId ? [c.rateId] : [], vendorIds: [c.vendorId],
  }))
  for (const part of o.parts ?? []) {
    lines.push({
      lineKey: part.lineKey, description: part.description, qty: part.qty * o.multiplier, unit: part.unit,
      unitCostIdr: part.unitCostIdr, unitSellIdr: part.unitSellIdr, mode: 'auto', ref: part.ref, fxRateIds: [], vendorIds: [],
    })
  }

  // Selisih terhadap jual titik (harga manual, atau komponen yang berubah sejak hitung-ulang terakhir) ditutup eksplisit.
  const targetCents = cents(point.sellIdr) * o.multiplier
  const gapCents = targetCents - Math.round(sumSell(lines) * 100)
  if (gapCents !== 0) {
    const only = lines.length === 0
    lines.push({
      lineKey: only ? 'main' : 'penyesuaian', description: only ? o.label : 'Penyesuaian harga paket', qty: o.multiplier, unit: 'package',
      unitCostIdr: null, unitSellIdr: gapCents / 100 / o.multiplier, mode: point.mode,
      ref: { ownerType: o.ownerType, ownerId: o.ownerId, variantKey: '' }, fxRateIds: [], vendorIds: [],
    })
  }
  return lines
}

// ── penulisan ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ItemMeta = { itemType: string; itemId: string; label: string; detail: string; qty: number }
export type PendingItem = { meta: ItemMeta; lines: SnapshotLine[] }

/**
 * Tulis seluruh baris snapshot booking dan kembalikan TOTAL = Σ jual baris yang baru ditulis (invarian I4 secara konstruksi: pemanggil mengisi
 * `Booking.totalAmount` dengan angka ini, bukan jumlah yang dihitung terpisah). Dipanggil sekali per booking, di transaksi yang sama dengan baris itemnya.
 */
export async function writeSnapshots(db: Db, bookingId: string, items: readonly PendingItem[]): Promise<number> {
  let totalCents = 0
  const rows: Prisma.PriceSnapshotCreateManyInput[] = []
  for (const { meta, lines } of items) {
    for (const l of lines) {
      const sell = lineTotalSell(l)
      totalCents += Math.round(sell * 100)
      rows.push({
        bookingId, itemType: meta.itemType, itemId: meta.itemId, lineKey: l.lineKey,
        ownerType: l.ref?.ownerType ?? null, ownerId: l.ref?.ownerId ?? null, variantKey: l.ref?.variantKey ?? '',
        itemLabel: meta.label, itemDetail: meta.detail, itemQty: meta.qty,
        description: l.description, qty: l.qty, unit: l.unit,
        // satuan disimpan sudah dibulatkan ke sen — total dihitung dari nilai yang SAMA yang tersimpan (CHECK DB: total = ROUND(satuan × jumlah, 2))
        unitCostIdr: l.unitCostIdr == null ? null : cents(l.unitCostIdr) / 100, unitSellIdr: cents(l.unitSellIdr) / 100,
        totalCostIdr: lineTotalCost(l), totalSellIdr: sell,
        mode: l.mode, fxRateIds: l.fxRateIds, vendorIds: l.vendorIds,
      })
    }
  }
  if (rows.length > 0) await db.priceSnapshot.createMany({ data: rows })
  return totalCents / 100
}
