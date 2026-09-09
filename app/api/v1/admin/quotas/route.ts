import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'

export async function GET() {
  try {
    await requireAdmin()
    const [hotels, transports, muthowif] = await Promise.all([
      prisma.hotelRoomSchedule.findMany({ include: { period: { include: { hotel: true } }, roomType: true } }),
      prisma.transportQuota.findMany({ include: { pricing: { include: { trip: true, vehicle: true } } }, take: 50, orderBy: { travelDate: 'asc' } }),
      prisma.muthowifAvailability.findMany({ where: { date: { gte: new Date() } }, take: 30, include: { muthowif: true } }),
    ])
    return NextResponse.json(ok({ hotels, transports, muthowif }))
  } catch (e) {
    if (e instanceof Error && e.message === 'Forbidden') return NextResponse.json(err('Forbidden'), { status: 403 })
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
