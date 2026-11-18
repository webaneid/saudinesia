import type { Prisma, RevenueShareBasis } from '@prisma/client'

// POTENSI bagi hasil Platform Provider per booking (docs/arsitektur-bagi-hasil.md §4, Fase 13b). Diturunkan dari dua hal yang sama-sama BEKU:
// aturan di invoice (persen + dasar, P4) dan baris snapshot harga yang berlaku — jadi tidak disimpan per baris dan tak bisa menyimpang dari keduanya.
// Hak (yang benar-benar terhitung dari pembayaran) di Fase 13c; potensi akhir beku saat Tandai selesai di Fase 13d.

export type ShareRule = { percent: number; basis: RevenueShareBasis }
export type ShareLine = { itemType: string; lineKey: string; totalCostIdr: number | null; totalSellIdr: number }

const cents = (x: number): number => Math.round(x * 100)
/** Baris selisih/penyesuaian: modalnya ada di baris item (modal 0), jualnya hanya menggeser margin. */
const isAdjustment = (l: ShareLine): boolean => l.itemType === 'booking' || l.lineKey.startsWith('penyesuaian')

/**
 * Bagian satu baris (sen, bertanda):
 *  - markup: persen × modal baris bermodal (poin itu sudah termasuk di harga otomatis). Diskon/penyesuaian tidak mengurangi bagian — itu keputusan harga klien.
 *  - margin: persen × (jual − modal) baris bermodal; penyesuaian (diskon −, biaya tambahan +) ikut menggeser margin. Baris asli tanpa modal = 0 (untungnya tak diketahui).
 */
export function lineShareCents(l: ShareLine, rule: ShareRule): number {
  const p = rule.percent / 100
  if (rule.basis === 'markup') return l.totalCostIdr == null ? 0 : Math.round(cents(l.totalCostIdr) * p)
  if (l.totalCostIdr != null) return Math.round((cents(l.totalSellIdr) - cents(l.totalCostIdr)) * p)
  return isAdjustment(l) ? Math.round(cents(l.totalSellIdr) * p) : 0
}

/** Potensi satu booking (rupiah): Σ bagian baris, tak pernah negatif (booking rugi tidak membuat Platform Provider berutang). */
export function sharePotential(lines: readonly ShareLine[], rule: ShareRule | null): number {
  if (!rule || rule.percent <= 0) return 0
  const total = lines.reduce((s, l) => s + lineShareCents(l, rule), 0)
  return Math.max(0, total) / 100
}

/**
 * Potensi AKHIR saat Tandai selesai (Fase 13d, Q1): dasar margin memakai pengeluaran vendor AKTUAL — modal tiap baris rencana = Σ pengeluaran aktif yang merujuknya
 * (bila ada), selain itu modal rencana; pengeluaran tanpa baris berlaku (`looseActualIdr`: tanpa rujukan atau pada baris yang sudah di-void) mengurangi margin.
 * Dasar markup tidak dikoreksi (poin dihitung dari modal rencana yang sudah ada di harga). Murni.
 */
export function finalSharePotential(lines: ReadonlyArray<ShareLine & { actualIdr: number | null }>, looseActualIdr: number, rule: ShareRule | null): number {
  if (!rule || rule.percent <= 0) return 0
  if (rule.basis === 'markup') return sharePotential(lines, rule)
  const total = lines.reduce((s, l) => s + lineShareCents({ ...l, totalCostIdr: l.actualIdr ?? l.totalCostIdr }, rule), 0)
    - Math.round(cents(looseActualIdr) * (rule.percent / 100))
  return Math.max(0, total) / 100
}

type Db = Pick<Prisma.TransactionClient, 'invoice' | 'priceSnapshot' | 'booking' | 'costActual'>

async function ruleOf(db: Db, bookingId: string): Promise<ShareRule | null> {
  const inv = await db.invoice.findUnique({ where: { bookingId }, select: { revenueSharePercent: true, revenueShareBasis: true } })
  return inv?.revenueSharePercent != null && inv.revenueShareBasis ? { percent: Number(inv.revenueSharePercent), basis: inv.revenueShareBasis } : null
}

async function planLines(db: Db, bookingId: string) {
  const rows = await db.priceSnapshot.findMany({
    where: { bookingId, voidedAt: null }, // baris di-void revisi tak berlaku (T1)
    select: { id: true, itemType: true, lineKey: true, totalCostIdr: true, totalSellIdr: true },
  })
  return rows.map(r => ({ id: r.id, itemType: r.itemType, lineKey: r.lineKey, totalCostIdr: r.totalCostIdr == null ? null : Number(r.totalCostIdr), totalSellIdr: Number(r.totalSellIdr) }))
}

/** Potensi RENCANA (aturan beku + baris snapshot berlaku) — tanpa memandang status selesai. */
export async function planSharePotential(db: Db, bookingId: string): Promise<{ rule: ShareRule | null; potentialIdr: number }> {
  const rule = await ruleOf(db, bookingId)
  if (!rule) return { rule: null, potentialIdr: 0 }
  return { rule, potentialIdr: sharePotential(await planLines(db, bookingId), rule) }
}

/** Potensi AKHIR untuk dibekukan saat Tandai selesai (lihat `finalSharePotential`). Hanya pengeluaran aktif (tidak dibatalkan). */
export async function completionSharePotential(db: Db, bookingId: string): Promise<number> {
  const rule = await ruleOf(db, bookingId)
  if (!rule) return 0
  const lines = await planLines(db, bookingId)
  const actuals = await db.costActual.findMany({ where: { bookingId, voidedAt: null }, select: { snapshotId: true, amountIdr: true } })
  const byLine = new Map<string, number>()
  let loose = 0
  const live = new Set(lines.map(l => l.id))
  for (const a of actuals) {
    if (a.snapshotId && live.has(a.snapshotId)) byLine.set(a.snapshotId, (byLine.get(a.snapshotId) ?? 0) + cents(Number(a.amountIdr)))
    else loose += cents(Number(a.amountIdr))
  }
  return finalSharePotential(lines.map(l => ({ ...l, actualIdr: byLine.has(l.id) ? byLine.get(l.id)! / 100 : null })), loose / 100, rule)
}

/**
 * Potensi BERLAKU satu booking: booking `completed` dengan potensi beku (`completedPotentialIdr`, ditulis saat Tandai selesai — Fase 13d) → angka itu; selain itu
 * potensi rencana (termasuk booking selesai lama tanpa penanda). Tanpa invoice / tanpa aturan beku → potensi 0.
 */
export async function bookingSharePotential(db: Db, bookingId: string): Promise<{ rule: ShareRule | null; potentialIdr: number }> {
  const rule = await ruleOf(db, bookingId)
  if (!rule) return { rule: null, potentialIdr: 0 }
  const b = await db.booking.findUnique({ where: { id: bookingId }, select: { status: true, completedPotentialIdr: true } })
  if (b?.status === 'completed' && b.completedPotentialIdr != null) return { rule, potentialIdr: Number(b.completedPotentialIdr) }
  return { rule, potentialIdr: sharePotential(await planLines(db, bookingId), rule) }
}
