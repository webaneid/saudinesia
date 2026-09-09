import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'

// List HotelRoomSchedule aktif, flattened — dipakai dropdown "Hotel (opsional)" di package
// builder Paket Ziarah (docs/arsitektur-ziarah.md §10.4).
export async function GET() {
  try {
    await requireManager()
    const schedules = await prisma.hotelRoomSchedule.findMany({
      where: {
        isActive: true,
        period: { isActive: true },
        roomType: { isActive: true },
      },
      include: { period: { include: { hotel: true } }, roomType: true },
      orderBy: [{ period: { hotel: { name: 'asc' } } }, { roomType: { name: 'asc' } }],
    })
    const data = schedules.map(s => ({
      id: s.id,
      hotelName: s.period.hotel.name,
      city: s.period.hotel.city,
      roomTypeName: s.roomType.name,
      price: Number(s.price),
      periodStart: s.period.periodStart,
      periodEnd: s.period.periodEnd,
    }))
    return NextResponse.json(ok(data))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/hotels/schedules/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
