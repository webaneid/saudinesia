import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ok, err } from '@/lib/validators'
import { getFlightAirlineNames } from '@/lib/pricing/flightAirlines'
import { withSellPrice } from '@/lib/pricing/engine/read'

export async function GET() {
  try {
    const schedules = await withSellPrice('flight', await prisma.flightSchedule.findMany({
      where: { isActive: true, route: { isActive: true } },
      orderBy: { departureFrom: 'asc' },
      include: { route: true },
    }))
    const airlineByScheduleId = await getFlightAirlineNames(schedules.map(s => s.id))
    return NextResponse.json(ok(
      // Peta eksplisit (SEC-50): endpoint publik tidak boleh membocorkan kolom internal — `totalSeats`/`pendingSeats`/`bookedSeats`
      // mengungkap laju penjualan; yang publik cukup `availableSeats` (pola sama `catalog/transport`).
      schedules.map(s => ({
        id: s.id,
        routeId: s.routeId,
        departureFrom: s.departureFrom,
        departureTo: s.departureTo,
        price: s.price,
        availableSeats: Math.max(0, s.totalSeats - s.pendingSeats - s.bookedSeats),
        airlineName: airlineByScheduleId.get(s.id) ?? null,
        route: { id: s.route.id, origin: s.route.origin, destination: s.route.destination },
      })),
      { total: schedules.length }
    ))
  } catch (e) {
    console.error('[catalog/flight]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
