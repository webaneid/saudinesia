import type { ForceMajeureCategory, Prisma, RefundApprovalMode, RefundSource } from '@prisma/client'
import { billOf } from '@/lib/invoice/bill'
import { computeRefundAmount } from '@/lib/utils/cancellationPolicy'

// Aturan persetujuan refund (docs/rencana-force-majeure.md §3). Hanya refund PEMBATALAN yang dinilai; kelebihan bayar bukan pengecualian kebijakan.
//  • batas kebijakan = saran kebijakan atas uang terbayar saat batal + uang yang masuk SESUDAH batal (selalu boleh dikembalikan penuh);
//    tanpa baris pembatalan / tanpa tanggal berangkat = tanpa batas (null);
//  • di atas kebijakan → wajib force-majeure; perlu superadmin menurut `RefundApprovalMode`.
// `approvalFactsOf` dipanggil DI DALAM kunci booking (lib/refunds/service.ts); `evaluateRefundApproval` murni (dipakai juga halaman detail).

type Tx = Prisma.TransactionClient
const cents = (n: number) => Math.round(n * 100)

export type ApprovalFacts = {
  source: RefundSource
  amount: number
  /** Σ refund pembatalan booking yang tidak ditolak, selain baris ini. */
  otherCancellation: number
  /** Σ semua refund booking yang tidak ditolak, selain baris ini. */
  otherAll: number
  policyCap: number | null
  grandTotal: number
}
export type ApprovalVerdict = { abovePolicy: boolean; aboveHalf: boolean; needsForceMajeure: boolean; needsSuperadmin: boolean }

export function evaluateRefundApproval(f: ApprovalFacts, mode: RefundApprovalMode, forceMajeure: ForceMajeureCategory | null): ApprovalVerdict {
  if (f.source !== 'cancellation') return { abovePolicy: false, aboveHalf: false, needsForceMajeure: false, needsSuperadmin: false }
  const abovePolicy = f.policyCap !== null && cents(f.otherCancellation) + cents(f.amount) > cents(f.policyCap)
  const aboveHalf = 2 * (cents(f.otherAll) + cents(f.amount)) > cents(f.grandTotal)
  const needsSuperadmin = mode === 'above_policy' ? abovePolicy : mode === 'above_half' ? aboveHalf : abovePolicy || aboveHalf
  return { abovePolicy, aboveHalf, needsForceMajeure: abovePolicy && forceMajeure === null, needsSuperadmin }
}

/** Fakta untuk `evaluateRefundApproval` — dibaca di dalam kunci booking. `excludeRefundId` = baris yang sedang dinilai (sudah tersimpan). */
export async function approvalFactsOf(tx: Tx, bookingId: string, amount: number, source: RefundSource, excludeRefundId?: string): Promise<ApprovalFacts> {
  const b = await tx.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: {
      departureDate: true, totalAmount: true,
      invoice: { select: { taxAddedIdr: true, taxIncludedIdr: true } },
      cancellation: { select: { paidIdr: true, cancelledAt: true } },
    },
  })
  const others = await tx.refund.findMany({
    where: { bookingId, status: { not: 'rejected' }, ...(excludeRefundId ? { id: { not: excludeRefundId } } : {}) },
    select: { amount: true, source: true },
  })
  const sum = (rows: { amount: Prisma.Decimal }[]) => rows.reduce((s, r) => s + cents(Number(r.amount)), 0) / 100
  let policyCap: number | null = null
  if (b.cancellation && b.departureDate) {
    const late = await tx.payment.aggregate({ where: { bookingId, status: 'confirmed', confirmedAt: { gt: b.cancellation.cancelledAt } }, _sum: { amount: true } })
    policyCap = computeRefundAmount(Number(b.cancellation.paidIdr), b.departureDate, b.cancellation.cancelledAt) + Number(late._sum.amount ?? 0)
  }
  return {
    source, amount, policyCap,
    otherCancellation: sum(others.filter(r => r.source === 'cancellation')),
    otherAll: sum(others),
    grandTotal: billOf(b).grandTotal,
  }
}
