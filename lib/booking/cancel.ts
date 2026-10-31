import type { Prisma } from '@prisma/client'
import { quotaAdapters } from '@/lib/quota/adapters'
import { computeRefundAmount } from '@/lib/utils/cancellationPolicy'

type Tx = Prisma.TransactionClient

export type CancellableBooking = Prisma.BookingGetPayload<{
  include: { hotels: true; transports: true; muthowif: true; tourPackages: true; haji: true; flights: true; packages: true }
}>

// docs/arsitektur-booking.md §6 Step 3 — SATU fungsi dipakai self-cancel (DELETE
// /api/v1/bookings/[id]) DAN auto-cancel cron (lib/cron/autocancelJob.ts), menutup Gap #2
// (docs/arsitektur-umroh.md §7 — dulu self-cancel tidak melepas kuota apa pun sama sekali,
// padahal cron sudah benar) dan Gap #3 (refund dihitung tapi tidak pernah dicatat sebagai row).
// Katering & Visa sengaja tidak disertakan di loop release — no-op (tidak pernah reservasi kuota
// apa pun), lihat lib/quota/adapters/catering.ts & visa.ts.
// `finalStatus: 'expired'` (hangus, Fase 3) = booking yang belum pernah menerima uang: kuota dilepas, TIDAK ada refund (tak ada yang dikembalikan).
// Dasar refund = uang yang SUDAH MASUK (Σ pembayaran `confirmed`), bukan `totalAmount` — tanpa uang masuk tak ada baris Refund (SEC-118).
export async function cancelBooking(tx: Tx, booking: CancellableBooking, reason: string, finalStatus: 'cancelled' | 'expired' = 'cancelled'): Promise<{ refundAmount: number }> {
  await tx.booking.update({ where: { id: booking.id }, data: { status: finalStatus } })
  // Status kuota PER BARIS (`quotaConfirmed`): baris yang sudah dikonfirmasi melepas `booked`, sisanya `pending` (produk tambahan revisi bisa masih `pending`).

  for (const h of booking.hotels) await quotaAdapters.hotel.release(tx, h, { confirmed: h.quotaConfirmed })
  for (const t of booking.transports) await quotaAdapters.transport.release(tx, t, { confirmed: t.quotaConfirmed })
  for (const tp of booking.tourPackages) await quotaAdapters.tourPackage.release(tx, tp, { confirmed: tp.quotaConfirmed })
  for (const bm of booking.muthowif) await quotaAdapters.muthowif.release(tx, bm, { confirmed: bm.quotaConfirmed })
  for (const bh of booking.haji) await quotaAdapters.haji.release(tx, bh, { confirmed: bh.quotaConfirmed })
  for (const bf of booking.flights) await quotaAdapters.flight.release(tx, bf, { confirmed: bf.quotaConfirmed })
  for (const bp of booking.packages) await quotaAdapters.package.release(tx, bp, { confirmed: bp.quotaConfirmed })

  const paid = finalStatus === 'expired' || !booking.departureDate ? 0 : Number((await tx.payment.aggregate({ where: { bookingId: booking.id, status: 'confirmed' }, _sum: { amount: true } }))._sum.amount ?? 0)
  const refund = paid > 0 && booking.departureDate ? computeRefundAmount(paid, booking.departureDate) : 0
  if (refund > 0) {
    await tx.refund.create({ data: { bookingId: booking.id, amount: refund, reason, status: 'pending' } })
  }
  return { refundAmount: refund }
}
