import type { Prisma, RevenueShareBasis } from '@prisma/client'

// POTENSI bagi hasil Platform Provider per booking (docs/arsitektur-bagi-hasil.md §4, Fase 13b). Diturunkan dari dua hal yang sama-sama BEKU:
// aturan di invoice (persen + dasar, P4) dan baris snapshot harga yang berlaku — jadi tidak disimpan per baris dan tak bisa menyimpang dari keduanya.
// Hak (yang benar-benar terhitung dari pembayaran) baru di Fase 13c.

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

type Db = Pick<Prisma.TransactionClient, 'invoice' | 'priceSnapshot'>

/** Aturan beku + potensi booking dari invoice-nya dan baris snapshot BERLAKU (voidedAt NULL). Tanpa invoice / tanpa aturan beku → potensi 0. */
export async function bookingSharePotential(db: Db, bookingId: string): Promise<{ rule: ShareRule | null; potentialIdr: number }> {
  const inv = await db.invoice.findUnique({ where: { bookingId }, select: { revenueSharePercent: true, revenueShareBasis: true } })
  const rule = inv?.revenueSharePercent != null && inv.revenueShareBasis ? { percent: Number(inv.revenueSharePercent), basis: inv.revenueShareBasis } : null
  if (!rule) return { rule: null, potentialIdr: 0 }
  const rows = await db.priceSnapshot.findMany({
    where: { bookingId, voidedAt: null }, // baris di-void revisi tak berlaku (T1)
    select: { itemType: true, lineKey: true, totalCostIdr: true, totalSellIdr: true },
  })
  const lines = rows.map(r => ({ itemType: r.itemType, lineKey: r.lineKey, totalCostIdr: r.totalCostIdr == null ? null : Number(r.totalCostIdr), totalSellIdr: Number(r.totalSellIdr) }))
  return { rule, potentialIdr: sharePotential(lines, rule) }
}
