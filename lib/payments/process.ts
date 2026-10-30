import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { quotaAdapters } from '@/lib/quota/adapters'
import { resolveConfirmedAmount } from './confirmAmount'

// Konfirmasi / penolakan pembayaran oleh admin (satu-satunya pemroses). Dalam SATU transaksi yang mengunci baris booking, status payment/booking DIBACA ULANG di dalam kunci: konfirmasi/penolakan
// ganda atau paralel (dua admin, dobel klik) tak boleh menimpa jumlah yang sudah final, menjalankan konfirmasi kuota dua kali, menghidupkan booking yang sudah batal, atau membuka penyesuaian total
// pada booking yang pernah dibayar. Hanya payment `pending` pada booking `active` yang belum dikonfirmasi (`confirmedAt` kosong) yang dapat diproses.

export type ProcessInput = { action: 'confirm' | 'reject'; amount?: number | null; notes?: string | null; byUserId: string }
export type ProcessResult =
  | { kind: 'not_found' }
  | { kind: 'conflict' }
  | { kind: 'done'; userId: string; bookingId: string; code: string }

export async function processPayment(paymentId: string, input: ProcessInput): Promise<ProcessResult> {
  return prisma.$transaction(async (tx) => {
    const head = await tx.payment.findUnique({ where: { id: paymentId }, select: { bookingId: true } })
    if (!head) return { kind: 'not_found' }
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "bookings" WHERE "id" = ${head.bookingId} FOR UPDATE`) // Prisma ORM tak punya SELECT … FOR UPDATE
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } })
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: head.bookingId }, include: { hotels: true, transports: true, muthowif: true, tourPackages: true, haji: true, flights: true, packages: true } })
    if (payment.status !== 'pending' || booking.status !== 'active' || booking.confirmedAt !== null) return { kind: 'conflict' }

    if (input.action === 'confirm') {
      const confirmedAmount = resolveConfirmedAmount(Number(booking.totalAmount), { amount: input.amount, notes: input.notes })
      await tx.payment.update({ where: { id: paymentId }, data: { status: 'confirmed', amount: confirmedAmount, notes: input.notes ?? null, confirmedById: input.byUserId, confirmedAt: new Date() } })
      await tx.booking.update({ where: { id: booking.id }, data: { confirmedAt: new Date(), confirmedById: input.byUserId } })
      // Loop generik via adapter registry (docs/arsitektur-booking.md §6 Step 1) — tidak mungkin lagi ada tipe yang "terlupa" seperti insiden Muthowif kemarin.
      for (const h of booking.hotels) await quotaAdapters.hotel.confirm(tx, h)
      for (const t of booking.transports) await quotaAdapters.transport.confirm(tx, t)
      for (const tp of booking.tourPackages) await quotaAdapters.tourPackage.confirm(tx, tp)
      for (const bm of booking.muthowif) await quotaAdapters.muthowif.confirm(tx, bm)
      for (const bh of booking.haji) await quotaAdapters.haji.confirm(tx, bh)
      for (const bf of booking.flights) await quotaAdapters.flight.confirm(tx, bf)
      for (const bp of booking.packages) await quotaAdapters.package.confirm(tx, bp)
    } else {
      await tx.payment.update({ where: { id: paymentId }, data: { status: 'rejected', notes: input.notes ?? null } })
      // Status tampilan kembali "menunggu pembayaran" dengan sendirinya (turunan: tak ada lagi payment `pending`) — tak ada kolom yang diubah di booking.
    }
    return { kind: 'done', userId: booking.userId, bookingId: booking.id, code: booking.bookingCode }
  })
}
