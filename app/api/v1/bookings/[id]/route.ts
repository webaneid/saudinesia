import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireSession } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { cancelBooking } from '@/lib/booking/cancel'
import { displayStatus, isPilgrimCancellable } from '@/lib/booking/lifecycle'

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
        pilgrims:   { include: { visaApplication: true, documents: true } }, // modal/jejak beku ada di price_snapshots (tak pernah di-include untuk pilgrim — I5)
        // select eksplisit: `notes` (catatan staf) dan `confirmedById` TIDAK boleh sampai ke jamaah (Fase 7: catatan jumlah pembayaran bersifat internal)
        payments:   { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, status: true, amount: true, method: true, buktiTransferUploadedAt: true, confirmedAt: true, createdAt: true } },
      },
    })
    if (!booking) return NextResponse.json(err('Booking tidak ditemukan'), { status: 404 })

    // `status` = siklus hidup tersimpan; `displayStatus` = status yang dilihat jamaah (menunggu bayar / diverifikasi / dikonfirmasi / …)
    const hasPending = (await prisma.payment.count({ where: { bookingId: booking.id, status: 'pending' } })) > 0
    const { confirmedById: _staff, ...visible } = booking // id staf yang mengonfirmasi = internal (SEC-120)
    return NextResponse.json(ok({ ...visible, displayStatus: displayStatus({ status: booking.status, confirmedAt: booking.confirmedAt, hasPendingPayment: hasPending, departureDate: booking.departureDate, returnDate: booking.returnDate }) }))
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(err('Unauthorized'), { status: 401 })
    }
    console.error('[bookings/id/GET]', error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await params

    const owned = await prisma.booking.findFirst({ where: { id, userId: session.userId, status: { not: 'draft' } }, select: { id: true } }) // draf = 404, sama seperti GET
    if (!owned) return NextResponse.json(err('Booking tidak ditemukan'), { status: 404 })

    // docs/arsitektur-booking.md §6 Step 3 — menutup Gap #2 (dulu tidak melepas kuota apa pun,
    // tidak transaksional) dan Gap #3 (refund dihitung tapi tidak pernah dicatat sebagai row)
    // sekaligus, lewat fungsi yang SAMA dipakai cron hangus (lib/booking/expire.ts).
    // Status dibaca ULANG di dalam kunci baris: konfirmasi pembayaran yang berjalan serentak tak boleh dibatalkan setengah jalan.
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "bookings" WHERE "id" = ${id} FOR UPDATE`) // Prisma ORM tak punya SELECT … FOR UPDATE
      const booking = await tx.booking.findUniqueOrThrow({
        where: { id },
        include: { hotels: true, transports: true, muthowif: true, tourPackages: true, haji: true },
      })
      if (!isPilgrimCancellable(booking)) return null
      // Bukti transfer menunggu verifikasi = uang mungkin sudah dikirim: batal ditolak agar pembayaran itu tetap bisa diproses admin (SEC-119).
      if (await tx.payment.count({ where: { bookingId: id, status: 'pending' } }) > 0) return null
      return cancelBooking(tx, booking, 'Dibatalkan oleh pilgrim')
    })
    if (!result) return NextResponse.json(err('Booking ini tidak dapat dibatalkan.'), { status: 422 })
    const { refundAmount } = result

    return NextResponse.json(ok({ refundAmount }))
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(err('Unauthorized'), { status: 401 })
    }
    console.error('[bookings/id/DELETE]', error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
