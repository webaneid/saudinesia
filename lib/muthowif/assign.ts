import type { Prisma } from '@prisma/client'
import { reserveMuthowifQuota, confirmMuthowifQuota } from '@/lib/quota'
import { calendarDateOf, dbDateOf, eachDay } from '@/lib/time'

type Tx = Prisma.TransactionClient

function* daysInRange(start: Date, end: Date) {
  for (const day of eachDay(calendarDateOf(start), calendarDateOf(end))) yield dbDateOf(day)
}

/**
 * Admin menetapkan muthowif spesifik ke satu line item booking (docs/arsitektur-muthowif.md §9.4).
 * Reservasi kapasitas INDIVIDUAL per hari dalam rentang — supaya satu muthowif tidak ter-assign
 * melebihi dailyCapacity-nya sendiri meski pool secara agregat masih cukup. Kalau booking sudah
 * lunas duluan (assignment terjadi belakangan), langsung confirm juga di transaksi yang sama
 * supaya tidak nyangkut di pending selamanya.
 */
export async function assignMuthowifToBooking(tx: Tx, bookingMuthowifId: string, muthowifId: string): Promise<void> {
  const bm = await tx.bookingMuthowif.findUniqueOrThrow({
    where: { id: bookingMuthowifId },
    include: { booking: { select: { status: true, confirmedAt: true } } },
  })
  if (bm.muthowifId) throw new Error('Sudah di-assign ke muthowif lain')

  const muthowif = await tx.muthowif.findUniqueOrThrow({ where: { id: muthowifId } })
  if (!muthowif.isActive) throw new Error('Muthowif tidak aktif')

  const alreadyPaid = bm.booking.confirmedAt !== null || bm.booking.status === 'completed' // sudah dikonfirmasi (lunas menurut alur v1)

  for (const date of daysInRange(bm.startDate, bm.endDate)) {
    await reserveMuthowifQuota(tx, muthowifId, date, bm.numPeople)
    if (alreadyPaid) await confirmMuthowifQuota(tx, muthowifId, date, bm.numPeople)
  }

  await tx.bookingMuthowif.update({
    where: { id: bookingMuthowifId },
    data: { muthowifId, assignedAt: new Date() },
  })
}
