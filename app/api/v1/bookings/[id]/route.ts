import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { cancelBooking } from '@/lib/booking/cancel'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await params

    const booking = await prisma.booking.findFirst({
      where: { id, userId: session.userId },
      include: {
        hotels:     { include: { hotelRoomSchedule: { include: { period: { include: { hotel: true } }, roomType: true } } } },
        transports: { include: { transportQuota: { include: { pricing: { include: { trip: true, vehicle: true } } } } } },
        muthowif:   { include: { muthowif: true } },
        catering:   { include: { cateringOption: true } },
        tourPackages: { include: { tourPackage: true, transportQuota: { include: { pricing: { include: { vehicle: true } } } } } },
        pilgrims:   { include: { visaApplication: true, documents: true } }, // modal/jejak beku ada di price_snapshots (tak pernah di-include untuk pilgrim — I5)
        payments:   { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    })
    if (!booking) return NextResponse.json(err('Booking tidak ditemukan'), { status: 404 })

    return NextResponse.json(ok(booking))
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

    const booking = await prisma.booking.findFirst({
      where: { id, userId: session.userId },
      include: { hotels: true, transports: true, muthowif: true, tourPackages: true, haji: true },
    })
    if (!booking) return NextResponse.json(err('Booking tidak ditemukan'), { status: 404 })
    if (['confirmed', 'active', 'completed', 'cancelled'].includes(booking.status)) {
      return NextResponse.json(err('Booking ini tidak dapat dibatalkan.'), { status: 422 })
    }

    // docs/arsitektur-booking.md §6 Step 3 — menutup Gap #2 (dulu tidak melepas kuota apa pun,
    // tidak transaksional) dan Gap #3 (refund dihitung tapi tidak pernah dicatat sebagai row)
    // sekaligus, lewat fungsi yang SAMA dipakai auto-cancel cron (lib/cron/autocancelJob.ts).
    const { refundAmount } = await prisma.$transaction(tx => cancelBooking(tx, booking, 'Dibatalkan oleh pilgrim'))

    return NextResponse.json(ok({ refundAmount }))
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(err('Unauthorized'), { status: 401 })
    }
    console.error('[bookings/id/DELETE]', error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
