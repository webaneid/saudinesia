import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ok, err } from '@/lib/validators'
import { z } from 'zod'

const querySchema = z.object({
  city:      z.enum(['makkah', 'madinah']).optional(),
  stars:     z.coerce.number().int().min(3).max(5).optional(),
  check_in:  z.string().date().optional(),
  check_out: z.string().date().optional(),
})

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const parsed = querySchema.safeParse(Object.fromEntries(searchParams))
    if (!parsed.success) return NextResponse.json(err('Parameter tidak valid'), { status: 400 })

    const { city, stars, check_in, check_out } = parsed.data
    const checkIn  = check_in  ? new Date(check_in)  : new Date()
    const checkOut = check_out ? new Date(check_out) : new Date(Date.now() + 7 * 86_400_000)

    // Harga & kuota di-resolve dari HotelRoomSchedule (lewat HotelPricePeriod) yang periodenya
    // mencakup checkIn/checkOut — bukan lagi detectSeason() (docs/arsitektur-hotel.md §10.1 poin 2,
    // §11.2). Bentuk response `schedules: [...]` di-flatten SAMA seperti sebelum §11 — supaya
    // wizard/konsumen publik lain tidak perlu berubah sama sekali (docs/arsitektur-hotel.md §11.4).
    const hotels = await prisma.hotel.findMany({
      where: { isActive: true, ...(city && { city }), ...(stars && { stars }) },
      include: {
        pricePeriods: {
          where: { isActive: true, periodStart: { lte: checkIn }, periodEnd: { gte: checkOut } },
          include: { schedules: { where: { isActive: true }, include: { roomType: true } } },
        },
      },
      orderBy: { distanceToHaramM: 'asc' },
    })

    const data = hotels.map((h) => {
      const schedules = h.pricePeriods.flatMap(p => p.schedules).map((s) => {
        const available = s.totalQuota - s.pendingQuota - s.bookedQuota
        return {
          id: s.id, roomTypeId: s.roomTypeId, roomTypeName: s.roomType.name,
          capacity: s.roomType.defaultCapacity,
          pricePerNight: Number(s.price),
          availableRooms: available,
        }
      })
      const minPrice       = schedules.length > 0 ? Math.min(...schedules.map((r) => r.pricePerNight)) : 0
      const totalAvailable = schedules.reduce((sum, r) => sum + r.availableRooms, 0)
      const availability   = schedules.length === 0 ? 'full' : totalAvailable > 20 ? 'available' : totalAvailable > 0 ? 'limited' : 'full'
      return {
        id: h.id, name: h.name, city: h.city, stars: h.stars,
        distanceToHaramM: h.distanceToHaramM, description: h.description,
        images: h.images, featuredImageKey: h.featuredImageKey, facilities: h.facilities,
        schedules, minPricePerNight: minPrice, availability,
      }
    })

    return NextResponse.json(ok(data, { total: data.length }))
  } catch (error) {
    console.error('[catalog/hotels]', error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
