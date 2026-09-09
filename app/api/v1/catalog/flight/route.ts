import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ok, err } from '@/lib/validators'
import { getFlightAirlineNames } from '@/lib/pricing/flightAirlines'

export async function GET() {
  try {
    const schedules = await prisma.flightSchedule.findMany({
      where: { isActive: true, route: { isActive: true } },
      orderBy: { departureFrom: 'asc' },
      include: { route: true },
    })
    const airlineByScheduleId = await getFlightAirlineNames(schedules.map(s => s.id))
    return NextResponse.json(ok(
      schedules.map(s => ({ ...s, price: Number(s.price), airlineName: airlineByScheduleId.get(s.id) ?? null })),
      { total: schedules.length }
    ))
  } catch (e) {
    console.error('[catalog/flight]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
