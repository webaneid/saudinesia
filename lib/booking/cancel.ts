import type { Prisma } from '@prisma/client'
import { quotaAdapters } from '@/lib/quota/adapters'
import { computeRefundAmount } from '@/lib/utils/cancellationPolicy'

type Tx = Prisma.TransactionClient

export type CancellableBooking = Prisma.BookingGetPayload<{
  include: { hotels: true; transports: true; muthowif: true; tourPackages: true; haji: true }
}>

// docs/arsitektur-booking.md §6 Step 3 — SATU fungsi dipakai self-cancel (DELETE
// /api/v1/bookings/[id]) DAN auto-cancel cron (lib/cron/autocancelJob.ts), menutup Gap #2
// (docs/arsitektur-umroh.md §7 — dulu self-cancel tidak melepas kuota apa pun sama sekali,
// padahal cron sudah benar) dan Gap #3 (refund dihitung tapi tidak pernah dicatat sebagai row).
// Katering & Visa sengaja tidak disertakan di loop release — no-op (tidak pernah reservasi kuota
// apa pun), lihat lib/quota/adapters/catering.ts & visa.ts.
export async function cancelBooking(tx: Tx, booking: CancellableBooking, reason: string): Promise<{ refundAmount: number }> {
  await tx.booking.update({ where: { id: booking.id }, data: { status: 'cancelled' } })

  for (const h of booking.hotels) await quotaAdapters.hotel.release(tx, h)
  for (const t of booking.transports) await quotaAdapters.transport.release(tx, t)
  for (const tp of booking.tourPackages) await quotaAdapters.tourPackage.release(tx, tp)
  for (const bm of booking.muthowif) await quotaAdapters.muthowif.release(tx, bm)
  for (const bh of booking.haji) await quotaAdapters.haji.release(tx, bh)

  const refund = computeRefundAmount(Number(booking.totalAmount), booking.departureDate)
  if (refund > 0) {
    await tx.refund.create({ data: { bookingId: booking.id, amount: refund, reason, status: 'pending' } })
  }
  return { refundAmount: refund }
}
