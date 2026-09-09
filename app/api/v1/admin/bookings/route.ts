import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'

export async function GET(req: Request) {
  try {
    await requireAdmin()
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const q      = searchParams.get('q')

    const { BookingStatus } = await import('@prisma/client')
    const bookings = await prisma.booking.findMany({
      where: {
        status: status && Object.values(BookingStatus).includes(status as never)
          ? (status as import('@prisma/client').BookingStatus)
          : undefined,
        OR: q ? [
          { bookingCode: { contains: q, mode: 'insensitive' } },
          { user: { fullName: { contains: q, mode: 'insensitive' } } },
        ] : undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { fullName: true, phone: true } }, _count: { select: { pilgrims: true } } },
    })
    return NextResponse.json(ok(bookings, { total: bookings.length }))
  } catch (e) {
    if (e instanceof Error && e.message === 'Forbidden') return NextResponse.json(err('Forbidden'), { status: 403 })
    console.error('[admin/bookings]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
