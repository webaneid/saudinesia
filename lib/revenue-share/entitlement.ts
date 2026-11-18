import type { Prisma, RevenueShareSource } from '@prisma/client'
import { billOf, billRefunds } from '@/lib/invoice/bill'
import { bookingSharePotential } from './potential'

// HAK bagi hasil Platform Provider (docs/arsitektur-bagi-hasil.md §5c, Fase 13c). SATU-SATUNYA penulis `revenue_share_entries` (append-only di DB).
// Rekonsiliasi, bukan delta per kejadian: target = potensi × min(1, terbayar ÷ tagihan); entri = target − Σ tercatat. Hak tak pernah melebihi potensi, kelebihan
// bayar tak menambah hak, dan revisi/penyesuaian/refund terkoreksi sendiri. HARUS dipanggil di dalam transaksi yang sudah mengunci baris booking (FOR UPDATE).

type Tx = Pick<Prisma.TransactionClient, 'booking' | 'invoice' | 'priceSnapshot' | 'revenueShareEntry' | 'costActual'>
const cents = (x: number | Prisma.Decimal): number => Math.round(Number(x) * 100)

/** Target hak (sen) = potensi × terbayar ÷ tagihan, EKSAK (BigInt atas sen bulat, setengah ke atas — hasil kali sen melewati 2^53 pada tagihan besar, SEC-284)
 *  + rasio 0..1 berpembulatan 6 desimal untuk jejak/tampilan. Murni. */
export function entitlementTarget(potentialIdr: number, paidIdr: number, grandTotalIdr: number): { ratio: number; targetCents: number } {
  const pot = cents(potentialIdr), paid = Math.max(0, cents(paidIdr)), grand = cents(grandTotalIdr)
  if (grand <= 0 || pot <= 0) return { ratio: grand > 0 ? Math.round(Math.min(1, paid / grand) * 1e6) / 1e6 : 0, targetCents: 0 }
  const capped = Math.min(paid, grand)
  const g = BigInt(grand)
  const target = Number((BigInt(pot) * BigInt(capped) * BigInt(2) + g) / (BigInt(2) * g))
  return { ratio: Math.round((capped / grand) * 1e6) / 1e6, targetCents: target }
}

export type ShareStatus = { potentialIdr: number; entitledIdr: number; paidRatio: number; percent: number | null; basis: 'margin' | 'markup' | null; final: boolean }

async function read(tx: Tx, bookingId: string) {
  const b = await tx.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { status: true, totalAmount: true, invoice: { select: { taxAddedIdr: true, taxIncludedIdr: true } }, payments: { where: { status: 'confirmed' }, select: { status: true, amount: true } }, refunds: billRefunds },
  })
  const bill = billOf(b)
  const { rule, potentialIdr } = await bookingSharePotential(tx, bookingId)
  const recorded = await tx.revenueShareEntry.aggregate({ where: { bookingId }, _sum: { amountIdr: true } })
  return { bill, rule, potentialIdr, recordedCents: cents(recorded._sum.amountIdr ?? 0), final: b.status === 'completed' }
}

/** Sinkronkan hak satu booking sesudah uang/tagihan berubah. Mengembalikan entri yang ditulis (sen) atau 0. Idempoten per (source, refId). */
export async function syncRevenueShare(tx: Tx, bookingId: string, cause: { source: RevenueShareSource; refId: string }): Promise<number> {
  const { bill, potentialIdr, recordedCents } = await read(tx, bookingId)
  const { ratio, targetCents } = entitlementTarget(potentialIdr, bill.paid, bill.grandTotal)
  const delta = targetCents - recordedCents
  if (delta === 0) return 0
  // Penyebab yang sama dua kali biasanya delta 0 (tercatat sudah = target). Bila penyebab yang sama perlu koreksi lagi, kunci diberi akhiran = jumlah entri booking
  // ini (tabel append-only + kunci booking → selalu naik, tak pernah bertabrakan; SEC-283) — tabrakan UNIQUE akan menggagalkan transaksi uang pemanggil.
  const exists = await tx.revenueShareEntry.findUnique({ where: { source_refId: { source: cause.source, refId: cause.refId } }, select: { id: true } })
  const refId = exists ? `${cause.refId}#${await tx.revenueShareEntry.count({ where: { bookingId } })}` : cause.refId
  await tx.revenueShareEntry.create({
    data: { bookingId, source: cause.source, refId, amountIdr: delta / 100, potentialIdr, paidRatio: ratio, entitledAfterIdr: targetCents / 100 },
  })
  return delta
}

/** Potensi vs hak satu booking — HANYA untuk tampilan superadmin (rincian bagi hasil internal, SEC-281). */
export async function bookingShareStatus(tx: Tx, bookingId: string): Promise<ShareStatus> {
  const { bill, rule, potentialIdr, recordedCents, final } = await read(tx, bookingId)
  return { final, potentialIdr, entitledIdr: recordedCents / 100, paidRatio: entitlementTarget(potentialIdr, bill.paid, bill.grandTotal).ratio, percent: rule?.percent ?? null, basis: rule?.basis ?? null }
}
