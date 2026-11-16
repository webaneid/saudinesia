import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { BOOKING_PILGRIM_SAFE_SELECT } from '@/lib/pilgrims/bookingLink'
import { requireSession } from '@/lib/auth/session'
import { ok } from '@/lib/validators'
import { cancelBooking } from '@/lib/booking/cancel'
import { displayStatus, isPilgrimCancellable } from '@/lib/booking/lifecycle'
import { apiErrorJson } from '@/lib/errors/api'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await params

    const booking = await prisma.booking.findFirst({
      where: { id, userId: session.userId, status: { not: 'draft' } }, // draf = urusan admin, tak tampil ke jamaah
      include: {
        hotels:     { include: { hotelRoomSchedule: { include: { period: { include: { hotel: true } }, roomType: true } } } },
        transports: { include: { transportQuota: { include: { pricing: { include: { trip: true, vehicle: true } } } } } },
        muthowif:   { include: { muthowif: true } },
        catering:   { include: { cateringOption: true } },
        tourPackages: { include: { tourPackage: true, transportQuota: { include: { pricing: { include: { vehicle: true } } } } } },
        // select aman: tanpa kolom NIK/paspor tersegel (docs/arsitektur-jamaah.md §5.3); modal/jejak beku ada di price_snapshots (tak pernah untuk pilgrim — I5)
        pilgrims:   { orderBy: { id: 'asc' }, select: { ...BOOKING_PILGRIM_SAFE_SELECT, visaApplication: true } },
        // select eksplisit: `notes` (catatan staf) dan `confirmedById` TIDAK boleh sampai ke jamaah (Fase 7: catatan jumlah pembayaran bersifat internal)
        payments:   { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, status: true, amount: true, method: true, buktiTransferUploadedAt: true, confirmedAt: true, createdAt: true } },
      },
    })
    if (!booking) return apiErrorJson('bookingNotFound', 404)

    // `status` = siklus hidup tersimpan; `displayStatus` = status yang dilihat jamaah (menunggu bayar / diverifikasi / dikonfirmasi / …)
    const hasPending = (await prisma.payment.count({ where: { bookingId: booking.id, status: 'pending' } })) > 0
    const { confirmedById: _staff, ...visible } = booking // id staf yang mengonfirmasi = internal (SEC-120)
    return NextResponse.json(ok({ ...visible, displayStatus: displayStatus({ status: booking.status, confirmedAt: booking.confirmedAt, hasPendingPayment: hasPending, departureDate: booking.departureDate, returnDate: booking.returnDate }) }))
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return apiErrorJson('unauthorized', 401)
    }
    console.error('[bookings/id/GET]', error)
    return apiErrorJson('internal', 500)
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await params

    const owned = await prisma.booking.findFirst({ where: { id, userId: session.userId, status: { not: 'draft' } }, select: { id: true } }) // draf = 404, sama seperti GET
    if (!owned) return apiErrorJson('bookingNotFound', 404)

    // Status dan uang dibaca ULANG di dalam kunci baris (konfirmasi pembayaran serentak tak boleh dibatalkan setengah jalan). Fase 7b-2a: pelanggan hanya
    // membatalkan pesanan TANPA uang — bukti menunggu verifikasi (SEC-119) atau pembayaran terverifikasi → 409 `cancelNeedsAdmin` (staf memutuskan refund, lib/booking/adminCancel.ts).
    const result = await prisma.$transaction(async (tx): Promise<'done' | 'closed' | 'money'> => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "bookings" WHERE "id" = ${id} FOR UPDATE`) // Prisma ORM tak punya SELECT … FOR UPDATE
      const booking = await tx.booking.findUniqueOrThrow({
        where: { id },
        include: { hotels: true, transports: true, muthowif: true, tourPackages: true, haji: true, flights: true, packages: true },
      })
      if (!isPilgrimCancellable(booking)) return 'closed'
      if (await tx.payment.count({ where: { bookingId: id, status: { in: ['pending', 'confirmed'] } } }) > 0) return 'money'
      await cancelBooking(tx, booking, 'cancelled')
      await tx.bookingCancellation.create({ data: { bookingId: id, cancelledAt: new Date(), cancelledById: session.userId, byCustomer: true, reason: 'Dibatalkan oleh pemesan', paidIdr: 0, decision: 'none' } })
      return 'done'
    })
    if (result === 'closed') return apiErrorJson('bookingCannotCancel', 422)
    if (result === 'money') return apiErrorJson('cancelNeedsAdmin', 409)

    return NextResponse.json(ok({ cancelled: true }))
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return apiErrorJson('unauthorized', 401)
    }
    console.error('[bookings/id/DELETE]', error)
    return apiErrorJson('internal', 500)
  }
}
