import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { billOf, billRefunds } from '@/lib/invoice/bill'
import { resolveCashTarget, type CashTarget } from '@/lib/cash/accounts'
import { postEntries } from '@/lib/cash/ledger'

// Refund — SATU penulis tabel `refunds` (Fase 7b-2a, docs/arsitektur-booking-engine-v2.md §10.10). Siklus: pending → approved → paid | rejected.
// Setiap operasi mengunci baris booking dulu lalu membaca ulang di dalam kunci; uang keluar (paid) memosting entri buku kas `refund` di transaksi yang sama.
// Batas jumlah (dinilai di dalam kunci): booking BATAL → terbayar bersih − refund terbuka; booking hidup → hanya KELEBIHAN bayar (terbayar − tagihan) − refund terbuka.
// Refund terbuka = pending/approved (yang `paid` sudah mengurangi terbayar lewat billOf). `reason`/`notes` = teks staf → dikosongkan lib/account/deletion.ts.

type Tx = Prisma.TransactionClient
const cents = (n: number) => Math.round(n * 100)

export type RefundFailure =
  | { kind: 'not_found' }
  | { kind: 'conflict' } // status sudah berubah
  | { kind: 'over_limit'; max: number }
  | { kind: 'needs_account' }
  | { kind: 'invalid_date' }
  | { kind: 'decision_pending' } // pembatalan ditahan/ditunda: putuskan lewat decideDeferred, bukan usulan biasa
export type RefundOk<T = unknown> = { kind: 'done' } & T

export async function lockBooking(tx: Tx, bookingId: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "bookings" WHERE "id" = ${bookingId} FOR UPDATE`) // Prisma ORM tak punya SELECT … FOR UPDATE
}

/** Sisa yang masih boleh dikembalikan (dibaca di dalam kunci). `excludeRefundId` = baris yang sedang diubah jumlahnya. */
export async function refundableOf(tx: Tx, bookingId: string, excludeRefundId?: string): Promise<{ max: number; paid: number; cancelled: boolean }> {
  const b = await tx.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: {
      status: true, totalAmount: true,
      invoice: { select: { taxAddedIdr: true, taxIncludedIdr: true } },
      payments: { where: { status: 'confirmed' }, select: { status: true, amount: true } },
      refunds: billRefunds,
    },
  })
  const open = await tx.refund.findMany({ where: { bookingId, status: { in: ['pending', 'approved'] }, ...(excludeRefundId ? { id: { not: excludeRefundId } } : {}) }, select: { amount: true } })
  const openC = open.reduce((s, r) => s + cents(Number(r.amount)), 0)
  const bill = billOf(b)
  const cancelled = b.status === 'cancelled' || b.status === 'expired'
  const base = cancelled ? cents(bill.paid) : Math.max(0, cents(bill.paid) - cents(bill.grandTotal))
  return { max: Math.max(0, base - openC) / 100, paid: bill.paid, cancelled }
}

/** Dipanggil DI DALAM transaksi yang sudah mengunci booking (pembatalan admin / keputusan tunda / usulan kelebihan bayar). */
export async function createRefundTx(tx: Tx, input: { bookingId: string; amount: number; reason: string; byUserId: string }): Promise<RefundFailure | RefundOk<{ refundId: string }>> {
  const { max, cancelled } = await refundableOf(tx, input.bookingId)
  if (cents(input.amount) <= 0 || cents(input.amount) > cents(max)) return { kind: 'over_limit', max }
  const row = await tx.refund.create({
    data: { bookingId: input.bookingId, amount: input.amount, reason: input.reason, source: cancelled ? 'cancellation' : 'overpayment', status: 'pending', createdById: input.byUserId },
    select: { id: true },
  })
  return { kind: 'done', refundId: row.id }
}

/**
 * Uang yang masuk SESUDAH pembatalan (bayar online yang lunas belakangan, Fase 9 K9-4) dikurangi refund yang diusulkan sejak itu: tak termasuk keputusan
 * `retain`/`defer` (yang hanya menyangkut uang yang ada saat batal), jadi boleh diusulkan dikembalikan biasa (SEC-259).
 */
async function lateMoneyOf(tx: Tx, bookingId: string, since: Date): Promise<number> {
  const paid = await tx.payment.aggregate({ where: { bookingId, status: 'confirmed', confirmedAt: { gt: since } }, _sum: { amount: true } })
  const refunded = await tx.refund.aggregate({ where: { bookingId, status: { not: 'rejected' }, createdAt: { gt: since } }, _sum: { amount: true } })
  return Math.max(0, Number(paid._sum.amount ?? 0) - Number(refunded._sum.amount ?? 0))
}

/** Usulan refund atas booking (kelebihan bayar pada booking hidup, atau sisa uang pada booking batal). */
export async function proposeRefund(bookingId: string, input: { amount: number; reason: string; byUserId: string }): Promise<RefundFailure | RefundOk<{ refundId: string }>> {
  return prisma.$transaction(async (tx) => {
    const exists = await tx.booking.findUnique({ where: { id: bookingId }, select: { status: true } })
    if (!exists || exists.status === 'draft') return { kind: 'not_found' }
    await lockBooking(tx, bookingId)
    // Keputusan pembatalan `retain`/`defer` tak boleh dilangkahi usulan biasa (jejak keputusan harus sama dengan uang yang keluar).
    const c = await tx.bookingCancellation.findUnique({ where: { bookingId }, select: { decision: true, cancelledAt: true } })
    if (c && (c.decision === 'retain' || c.decision === 'defer') && cents(input.amount) > cents(await lateMoneyOf(tx, bookingId, c.cancelledAt))) return { kind: 'decision_pending' }
    return createRefundTx(tx, { bookingId, ...input })
  })
}

async function withRefund<T>(refundId: string, fn: (tx: Tx, r: { id: string; bookingId: string; status: string; amount: number }) => Promise<T>): Promise<T | { kind: 'not_found' }> {
  return prisma.$transaction(async (tx) => {
    const head = await tx.refund.findUnique({ where: { id: refundId }, select: { bookingId: true } })
    if (!head) return { kind: 'not_found' as const }
    await lockBooking(tx, head.bookingId)
    const r = await tx.refund.findUniqueOrThrow({ where: { id: refundId }, select: { id: true, bookingId: true, status: true, amount: true } })
    return fn(tx, { ...r, amount: Number(r.amount) })
  })
}

export async function updateRefundAmount(refundId: string, input: { amount: number; reason: string }): Promise<RefundFailure | RefundOk> {
  return withRefund(refundId, async (tx, r) => {
    if (r.status !== 'pending') return { kind: 'conflict' as const }
    const { max } = await refundableOf(tx, r.bookingId, r.id)
    if (cents(input.amount) <= 0 || cents(input.amount) > cents(max)) return { kind: 'over_limit' as const, max }
    await tx.refund.update({ where: { id: r.id }, data: { amount: input.amount, reason: input.reason } })
    return { kind: 'done' as const }
  })
}

export async function approveRefund(refundId: string, byUserId: string): Promise<RefundFailure | RefundOk> {
  return withRefund(refundId, async (tx, r) => {
    if (r.status !== 'pending') return { kind: 'conflict' as const }
    // Batas dinilai ULANG (tagihan booking hidup bisa naik lewat revisi sesudah usulan → kelebihan bayar menyusut).
    const { max } = await refundableOf(tx, r.bookingId, r.id)
    if (cents(r.amount) > cents(max)) return { kind: 'over_limit' as const, max }
    await tx.refund.update({ where: { id: r.id }, data: { status: 'approved', approvedById: byUserId, approvedAt: new Date() } })
    return { kind: 'done' as const }
  })
}

export async function rejectRefund(refundId: string, input: { byUserId: string; notes: string | null }): Promise<RefundFailure | RefundOk> {
  return withRefund(refundId, async (tx, r) => {
    if (r.status !== 'pending' && r.status !== 'approved') return { kind: 'conflict' as const }
    await tx.refund.update({ where: { id: r.id }, data: { status: 'rejected', rejectedById: input.byUserId, rejectedAt: new Date(), notes: input.notes } })
    return { kind: 'done' as const }
  })
}

const CLOCK_SKEW_MS = 5 * 60_000

/** Uang benar-benar dikembalikan: hanya refund `approved`; akun kas wajib; entri buku kas `out`/`refund` di transaksi yang sama. */
export async function payRefund(refundId: string, input: { byUserId: string; cashAccount: CashTarget; paidAt: Date; notes: string | null }): Promise<RefundFailure | RefundOk> {
  if (input.paidAt.getTime() > Date.now() + CLOCK_SKEW_MS) return { kind: 'invalid_date' }
  return withRefund(refundId, async (tx, r) => {
    if (r.status !== 'approved') return { kind: 'conflict' as const }
    // Batas dinilai ULANG di dalam kunci (booking hidup = kelebihan bayar saat ini; batal = terbayar bersih) — juga menjamin uang keluar ≤ uang masuk.
    const { max } = await refundableOf(tx, r.bookingId, r.id)
    if (cents(r.amount) > cents(max)) return { kind: 'over_limit' as const, max }
    const approved = await tx.refund.findUniqueOrThrow({ where: { id: r.id }, select: { approvedAt: true } })
    if (approved.approvedAt && input.paidAt.getTime() < approved.approvedAt.getTime() - CLOCK_SKEW_MS) return { kind: 'invalid_date' as const } // tak sebelum disetujui (periode kas)
    const cashAccountId = await resolveCashTarget(tx, input.cashAccount)
    if (!cashAccountId) return { kind: 'needs_account' as const }
    await tx.refund.update({ where: { id: r.id }, data: { status: 'paid', paidAt: input.paidAt, paidById: input.byUserId, cashAccountId, ...(input.notes ? { notes: input.notes } : {}) } })
    await postEntries(tx, { refType: 'refund', refId: r.id, direction: 'out', cashAccountId, entryDate: input.paidAt, bookingId: r.bookingId, createdById: input.byUserId }, [{ component: 'refund', amountIdr: r.amount }])
    return { kind: 'done' as const }
  })
}
