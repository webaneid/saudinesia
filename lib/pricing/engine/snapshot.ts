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
  /** Harga OTOMATIS titik (HPP + margin bawaan); null pada pemilik manual-only. Dibekukan sebagai rekomendasi (Fase 8). */
  autoSellIdr: number | null
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
    sellIdr: Number(p.sellIdr), autoSellIdr: p.autoSellIdr == null ? null : Number(p.autoSellIdr), costIdr: p.costIdr == null ? null : Number(p.costIdr),
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
  /** Rekomendasi per satuan (harga otomatis). Kosong = sama dengan `unitSellIdr` (tak ada saran lain selain harga yang ditawarkan sistem). */
  recommendedUnitSellIdr?: number | null
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
/** Rekomendasi baris (rupiah): harga otomatis × jumlah; tanpa saran khusus = jual baris itu sendiri. */
export const lineTotalRecommended = (l: SnapshotLine): number => lineCents(l.recommendedUnitSellIdr ?? l.unitSellIdr, l.qty) / 100
/** Σ jual baris (rupiah). */
export const sumSell = (lines: readonly SnapshotLine[]): number => lines.reduce((s, l) => s + lineCents(l.unitSellIdr, l.qty), 0) / 100

export function lineFromPoint(p: TakenPoint, o: { lineKey?: string; description: string; qty: number; unit?: string }): SnapshotLine {
  return {
    lineKey: o.lineKey ?? 'main', description: o.description, qty: o.qty, unit: o.unit ?? p.unit,
    unitCostIdr: p.costIdr, unitSellIdr: p.sellIdr, recommendedUnitSellIdr: p.autoSellIdr != null && p.autoSellIdr > 0 ? p.autoSellIdr : p.sellIdr, mode: p.mode,
    ref: { ownerType: p.ownerType, ownerId: p.ownerId, variantKey: p.variantKey },
    fxRateIds: p.fxRateIds, vendorIds: p.vendorIds,
  }
}

/** Bagian sub-modul yang ikut harga dasar paket (hotel/kendaraan `included`): jual tersimpan di paket, modal dari titik harga sub-modul bila ada. */
export type CompositePart = { lineKey: string; description: string; qty: number; unit: PriceUnit; unitSellIdr: number; unitCostIdr: number | null; ref: SnapshotLine['ref'] }

/**
 * Baris untuk produk KOMPOSIT (Paket Ziarah, Haji): harga dasar = JUAL TITIK HARGA pemiliknya (harga manual menang). Terurai menjadi satu baris per Komponen Biaya
 * (modal = HPP, jual = jual komponen), satu per bagian `included`, ditambah baris `penyesuaian` = jual titik − Σ baris (tak ditulis bila 0) sehingga Σ baris SELALU = jual titik × pengali.
 * `multiplier` = jumlah satuan yang dibeli (Haji dan Paket Umroh: orang; paket ziarah: 1 — harga per paket).
 * Titik harga tak ada → `ItemNotBookableError`. Jual titik 0 diizinkan (paket yang seluruhnya pilihan pilgrim); pemanggil menolak item bertotal 0.
 */
export async function compositeLines(db: Db, o: { ownerType: 'tour_package' | 'haji' | 'package'; ownerId: string; /** untuk pesan galat: "Harga {what} belum ditetapkan" */ what: string; /** judul baris bila seluruh harga berupa satu penyesuaian */ label: string; multiplier: number; parts?: CompositePart[] }): Promise<SnapshotLine[]> {
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
    // Rekomendasi total paket = harga OTOMATIS titik × pengali; baris selisih membawa sisanya (nol bila otomatis, selisih manual bila ditimpa) sehingga Σ rekomendasi baris = rekomendasi paket.
    const recTargetCents = cents(point.autoSellIdr != null && point.autoSellIdr > 0 ? point.autoSellIdr : point.sellIdr) * o.multiplier
    const recGapCents = recTargetCents - lines.reduce((s, l) => s + Math.round(lineTotalRecommended(l) * 100), 0)
    lines.push({
      lineKey: only ? 'main' : 'penyesuaian', description: only ? o.label : 'Penyesuaian harga paket', qty: o.multiplier, unit: 'package',
      unitCostIdr: null, unitSellIdr: gapCents / 100 / o.multiplier, recommendedUnitSellIdr: recGapCents / 100 / o.multiplier, mode: point.mode,
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
        totalCostIdr: lineTotalCost(l), totalSellIdr: sell, recommendedTotalIdr: lineTotalRecommended(l),
        mode: l.mode, fxRateIds: l.fxRateIds, vendorIds: l.vendorIds,
      })
    }
  }
  if (rows.length > 0) await db.priceSnapshot.createMany({ data: rows })
  return totalCents / 100
}

// ── penyesuaian tingkat-booking (docs/arsitektur-harga-terpadu.md §20) ─────────────────────────────────────────────────────────────────────────────────

/** Tulis SATU baris `penyesuaian` tingkat-booking (diskon negatif / biaya tambahan positif; modal 0 — modal ada di baris komponen). Dipanggil HANYA oleh lib/booking/adjustments.ts. */
export async function writeAdjustmentLine(db: Db, o: { bookingId: string; adjustmentId: string; label: string; amountIdr: number }): Promise<void> {
  const amount = cents(o.amountIdr) / 100
  await db.priceSnapshot.create({
    data: {
      bookingId: o.bookingId, itemType: 'booking', itemId: o.adjustmentId, lineKey: 'penyesuaian', variantKey: '',
      itemLabel: o.label, itemDetail: '', itemQty: 1, description: o.label, qty: 1, unit: 'item',
      unitCostIdr: null, unitSellIdr: amount, totalCostIdr: null, totalSellIdr: amount, recommendedTotalIdr: 0, mode: 'manual', // diskon/biaya tambahan bukan bagian rekomendasi
    },
  })
}

// ── revisi (T1, docs/arsitektur-booking-engine-v2.md §10.4 6b) ─────────────────────────────────────────────────────────────────────────────────────────

/** Batalkan (void) baris BERLAKU satu item booking — baris tetap ada sebagai jejak; trigger DB hanya mengizinkan pengisian kolom void sekali. `lineKeyPrefix` = hanya baris berawalan itu. */
export async function voidItemLines(db: Db, o: { bookingId: string; itemType: string; itemId: string; byUserId: string; reason: string; revision: number; lineKeyPrefix?: string }): Promise<number> {
  const r = await db.priceSnapshot.updateMany({
    where: { bookingId: o.bookingId, itemType: o.itemType, itemId: o.itemId, voidedAt: null, ...(o.lineKeyPrefix ? { lineKey: { startsWith: o.lineKeyPrefix } } : {}) },
    data: { voidedAt: new Date(), voidedById: o.byUserId, voidReason: o.reason, voidRevision: o.revision },
  })
  return r.count
}

/** Awalan baris harga KHUSUS item (R4): selisih harga khusus terhadap harga item; berawalan `penyesuaian` (boleh negatif, modal 0 — HPP asli tetap di baris item). */
export const CUSTOM_PRICE_PREFIX = 'penyesuaian-harga:'

/** Tulis baris harga khusus item (selisih ≠ 0). Judul/rincian item disalin dari baris item supaya invoice tetap menyatukannya; deskripsi netral (catatan staf TIDAK masuk snapshot). */
export async function writeCustomPriceLine(db: Db, o: { bookingId: string; itemType: string; itemId: string; revision: number; amountIdr: number; itemLabel: string; itemDetail: string; itemQty: number }): Promise<void> {
  const amount = cents(o.amountIdr) / 100
  if (amount === 0) return
  await db.priceSnapshot.create({
    data: {
      bookingId: o.bookingId, itemType: o.itemType, itemId: o.itemId, lineKey: `${CUSTOM_PRICE_PREFIX}r${o.revision}`, variantKey: '',
      itemLabel: o.itemLabel, itemDetail: o.itemDetail, itemQty: o.itemQty, description: 'Penyesuaian harga', qty: 1, unit: 'item',
      unitCostIdr: null, unitSellIdr: amount, totalCostIdr: null, totalSellIdr: amount, recommendedTotalIdr: 0, mode: 'manual',
    },
  })
}

/** Harga JUAL per item (Σ baris berlaku item itu, termasuk harga khusus) — kunci `itemType:itemId`. Hanya jual: aman untuk halaman jamaah (modal tak pernah keluar). */
export async function itemSellTotals(db: Db, bookingId: string): Promise<Map<string, number>> {
  const rows = await db.priceSnapshot.findMany({ where: { bookingId, voidedAt: null }, select: { itemType: true, itemId: true, totalSellIdr: true } })
  const m = new Map<string, number>()
  for (const r of rows) m.set(`${r.itemType}:${r.itemId}`, (m.get(`${r.itemType}:${r.itemId}`) ?? 0) + cents(Number(r.totalSellIdr)))
  return new Map([...m].map(([k, v]) => [k, v / 100]))
}

/** Σ jual baris snapshot BERLAKU (belum di-void) + Σ modal baris yang modalnya diketahui (HPP awal). */
export async function bookingSnapshotTotals(db: Db, bookingId: string): Promise<{ sellIdr: number; costKnownIdr: number }> {
  const agg = await db.priceSnapshot.aggregate({ where: { bookingId, voidedAt: null }, _sum: { totalSellIdr: true, totalCostIdr: true } }) // baris di-void revisi tak berlaku (T1)
  return { sellIdr: Number(agg._sum.totalSellIdr ?? 0), costKnownIdr: Number(agg._sum.totalCostIdr ?? 0) }
}

export type BookingPriceSummary = {
  /** Σ modal baris bermodal (HPP awal yang diketahui). */
  costKnownIdr: number
  /** Baris asli tanpa modal (selisih paket `penyesuaian` bukan baris tanpa modal: modalnya memang 0 — hanya selisih margin). */
  costUnknownLines: number
  /** Σ rekomendasi baris asli (di luar penyesuaian total pesanan). */
  recommendedIdr: number
  /** Baris LAMA manual tanpa rekomendasi beku: tidak ditebak, dilaporkan. */
  recommendedUnknownLines: number
  /** Harga jual total = Σ semua baris (invarian I4: sama dengan `Booking.totalAmount`). */
  sellIdr: number
}

/**
 * Tiga total pesanan (HPP · rekomendasi · jual) dari snapshot beku — SATU pembaca, supaya rumusnya tak bercabang (docs/arsitektur-harga-terpadu.md §21.2).
 * Rekomendasi per baris = nilai beku; baris lama (NULL) otomatis = jualnya, baris lama manual = tidak diketahui. Penyesuaian total pesanan (`itemType='booking'`) bukan bagian rekomendasi.
 */
export async function bookingPriceSummary(db: Db, bookingId: string): Promise<BookingPriceSummary> {
  const rows = await db.priceSnapshot.findMany({
    where: { bookingId, voidedAt: null }, // baris di-void revisi tak berlaku (T1)
    select: { itemType: true, lineKey: true, mode: true, totalCostIdr: true, totalSellIdr: true, recommendedTotalIdr: true },
  })
  let sell = 0, cost = 0, rec = 0, costUnknown = 0, recUnknown = 0
  for (const r of rows) {
    sell += cents(Number(r.totalSellIdr))
    if (r.totalCostIdr != null) cost += cents(Number(r.totalCostIdr))
    if (r.itemType === 'booking') continue // diskon/biaya tambahan tingkat pesanan: bukan modal, bukan rekomendasi
    if (r.totalCostIdr == null && !r.lineKey.startsWith('penyesuaian')) costUnknown++ // selisih paket & harga khusus item: modalnya ada di baris item
    if (r.recommendedTotalIdr != null) rec += cents(Number(r.recommendedTotalIdr))
    else if (r.mode === 'auto') rec += cents(Number(r.totalSellIdr))
    else recUnknown++
  }
  return { costKnownIdr: cost / 100, costUnknownLines: costUnknown, recommendedIdr: rec / 100, recommendedUnknownLines: recUnknown, sellIdr: sell / 100 }
}
