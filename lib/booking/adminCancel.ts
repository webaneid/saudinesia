import { prisma } from '@/lib/db'
import { cancelBooking } from '@/lib/booking/cancel'
import { expireAwaitingPayments } from '@/lib/payments/awaiting'
import { computeRefundAmount } from '@/lib/utils/cancellationPolicy'
import { createRefundTx, lockBooking, refundableOf } from '@/lib/refunds/service'

// Pembatalan oleh staf (Fase 7b-2a, docs/arsitektur-booking-engine-v2.md §10.10). Satu transaksi yang mengunci booking: status dan uang dibaca ULANG di dalam kunci,
// kuota dilepas lewat cancelBooking, lalu SATU baris `booking_cancellations` mencatat keputusan uang:
//   none   — belum ada uang masuk (terbayar bersih 0); semua admin boleh;
//   refund — usulan refund `pending` (jumlah ≤ terbayar bersih; bawaan = kebijakan pembatalan), diproses di lib/refunds/service.ts;
//   retain — uang ditahan (hangus/kompensasi biaya), catatan wajib;
//   defer  — diputuskan nanti (decideDeferred).
// Uang masuk → hanya peran refund (`canManageRefund`, diperiksa pemanggil dan diteruskan sebagai `canMoney`). Bukti transfer yang masih menunggu verifikasi menolak pembatalan.

export type CancelDecision = 'refund' | 'retain' | 'defer'
export type AdminCancelInput = { reason: string; decision?: CancelDecision | null; refundAmount?: number | null; note?: string | null; byUserId: string; canMoney: boolean }
export type AdminCancelResult =
  | { kind: 'not_found' }
  | { kind: 'conflict' }            // bukan booking aktif
  | { kind: 'pending_payment' }     // bukti menunggu verifikasi
  | { kind: 'forbidden_money' }     // uang masuk, peran tak boleh memutuskan
  | { kind: 'decision_required'; paid: number; suggested: number }
  | { kind: 'note_required' }
  | { kind: 'amount_required' } // saran kebijakan 0 → jumlah refund wajib diisi
  | { kind: 'over_limit'; max: number }
  | { kind: 'done'; userId: string; code: string; decision: 'none' | CancelDecision; paid: number; refundId: string | null }

/** Saran jumlah refund: kebijakan pembatalan atas tanggal berangkat; tanpa tanggal = seluruh terbayar. */
/** `at` = hari pembatalan (keputusan tertunda tetap memakai hari batal, bukan hari diputuskan). */
export function suggestedRefund(paid: number, departureDate: Date | null, at: Date = new Date()): number {
  if (paid <= 0) return 0
  return departureDate ? computeRefundAmount(paid, departureDate, at) : paid
}

export async function cancelByAdmin(bookingId: string, input: AdminCancelInput): Promise<AdminCancelResult> {
  return prisma.$transaction(async (tx): Promise<AdminCancelResult> => {
    const exists = await tx.booking.findUnique({ where: { id: bookingId }, select: { id: true } })
    if (!exists) return { kind: 'not_found' as const }
    await lockBooking(tx, bookingId)
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { hotels: true, transports: true, muthowif: true, tourPackages: true, haji: true, flights: true, packages: true } })
    if (booking.status !== 'active') return { kind: 'conflict' as const }
    if (await tx.payment.count({ where: { bookingId, status: 'pending' } }) > 0) return { kind: 'pending_payment' as const }
    const { paid } = await refundableOf(tx, bookingId)
    const money = Math.round(paid * 100) > 0
    if (money && !input.canMoney) return { kind: 'forbidden_money' as const }
    const decision: 'none' | CancelDecision | null = money ? input.decision ?? null : 'none'
    if (decision === null) return { kind: 'decision_required' as const, paid, suggested: suggestedRefund(paid, booking.departureDate) }
    if (decision === 'retain' && !input.note?.trim()) return { kind: 'note_required' as const }
    if (decision === 'refund' && input.refundAmount == null && suggestedRefund(paid, booking.departureDate) <= 0) return { kind: 'amount_required' as const }

    await cancelBooking(tx, booking, 'cancelled')
    await expireAwaitingPayments(tx, bookingId) // Fase 9: VA/QR yang masih hidup tak lagi dipakai (uang yang terlanjur masuk tetap dicatat, K9-4)
    let refundId: string | null = null
    if (decision === 'refund') {
      const amount = input.refundAmount ?? suggestedRefund(paid, booking.departureDate)
      const made = await createRefundTx(tx, { bookingId, amount, reason: input.reason, byUserId: input.byUserId })
      if (made.kind !== 'done') { if (made.kind === 'over_limit') throw new CancelAbort({ kind: 'over_limit', max: made.max }); throw new Error('refund gagal') }
      refundId = made.refundId
    }
    const now = new Date()
    await tx.bookingCancellation.create({
      data: {
        bookingId, cancelledAt: now, cancelledById: input.byUserId, byCustomer: false, reason: input.reason, paidIdr: paid, decision,
        ...(decision === 'defer' || decision === 'none' ? {} : { decidedAt: now, decidedById: input.byUserId }),
        decisionNote: input.note?.trim() || null,
      },
    })
    return { kind: 'done' as const, userId: booking.userId, code: booking.bookingCode, decision, paid, refundId }
  }).catch((e: unknown) => { if (e instanceof CancelAbort) return e.result; throw e })
}

// Melempar untuk me-rollback pembatalan (kuota sudah dilepas) bila usulan refund ditolak batasnya.
class CancelAbort extends Error { constructor(readonly result: AdminCancelResult) { super('cancel-abort') } }

export type DecideResult = { kind: 'not_found' } | { kind: 'conflict' } | { kind: 'note_required' } | { kind: 'over_limit'; max: number } | { kind: 'done'; refundId: string | null }

/** Keputusan atas pembatalan yang ditunda (`defer`) → refund atau tahan. */
export async function decideDeferred(bookingId: string, input: { decision: 'refund' | 'retain'; refundAmount?: number | null; note?: string | null; byUserId: string }): Promise<DecideResult> {
  return prisma.$transaction(async (tx): Promise<DecideResult> => {
    const c = await tx.bookingCancellation.findUnique({ where: { bookingId }, select: { id: true } })
    if (!c) return { kind: 'not_found' as const }
    await lockBooking(tx, bookingId)
    const fresh = await tx.bookingCancellation.findUniqueOrThrow({ where: { bookingId }, select: { id: true, decision: true, reason: true, cancelledAt: true, booking: { select: { departureDate: true } } } })
    if (fresh.decision !== 'defer') return { kind: 'conflict' as const }
    if (input.decision === 'retain' && !input.note?.trim()) return { kind: 'note_required' as const }
    let refundId: string | null = null
    if (input.decision === 'refund') {
      const { paid } = await refundableOf(tx, bookingId)
      const made = await createRefundTx(tx, { bookingId, amount: input.refundAmount ?? suggestedRefund(paid, fresh.booking.departureDate, fresh.cancelledAt), reason: fresh.reason, byUserId: input.byUserId })
      if (made.kind === 'over_limit') return { kind: 'over_limit' as const, max: made.max }
      if (made.kind !== 'done') return { kind: 'conflict' as const }
      refundId = made.refundId
    }
    await tx.bookingCancellation.update({ where: { id: fresh.id }, data: { decision: input.decision, decidedAt: new Date(), decidedById: input.byUserId, decisionNote: input.note?.trim() || null } })
    return { kind: 'done' as const, refundId }
  })
}
