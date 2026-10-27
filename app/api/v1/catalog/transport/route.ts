import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ok, err } from '@/lib/validators'
import { z } from 'zod'
import { sellPrices } from '@/lib/pricing/engine/read'

const querySchema = z.object({
  category: z.string().optional(),
  date:     z.string().date().optional(),
  tripId:   z.string().optional(),
})

// Satu harga flat per kombinasi rute×kendaraan (docs/arsitektur-transportasi.md §9) — tidak ada
// lagi logika season/charter/per-kursi, langsung baca TransportPricing.price (cache computeSellPrice()).
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const parsed = querySchema.safeParse(Object.fromEntries(searchParams))
    if (!parsed.success) return NextResponse.json(err('Parameter tidak valid'), { status: 400 })

    const { category, date, tripId } = parsed.data
    const travelDate = date ? new Date(date) : new Date(Date.now() + 7 * 86_400_000)

    const quotas = await prisma.transportQuota.findMany({
      where: {
        travelDate,
        bookedSeats: { lt: prisma.transportQuota.fields.totalSeats },
        pricing: {
          isActive: true,
          ...(tripId && { tripId }),
          trip: {
            isActive: true,
            ...(category && { category }),
          },
          vehicle: { isActive: true },
        },
      },
      include: {
        pricing: {
          include: {
            trip:    true,
            vehicle: true,
          },
        },
      },
      orderBy: [
        { pricing: { trip: { name: 'asc' } } },
        { pricing: { vehicle: { capacity: 'asc' } } },
      ],
    })

    const transportPrices = await sellPrices('transport', quotas.map(q => q.pricingId))
    const data = quotas.map((q) => {
      const { pricing } = q
      const { trip, vehicle } = pricing
      return {
        quotaId:     q.id,
        pricingId:   pricing.id,
        // Trip info
        tripId:          trip.id,
        tripName:        trip.name,
        tripCategory:    trip.category,
        tripDescription: trip.description,
        origin:          trip.origin,
        destination:     trip.destination,
        // Vehicle info
        vehicleId:   vehicle.id,
        vehicleName: vehicle.name,
        vehicleType: vehicle.vehicleType,
        capacity:    vehicle.capacity,
        fleetCount:  vehicle.fleetCount,
        // Pricing
        price: transportPrices.get(pricing.id) ?? 0,
        // Availability
        travelDate:     q.travelDate,
        availableSeats: q.totalSeats - q.pendingSeats - q.bookedSeats,
      }
    })

    // Group by trip for convenience
    const byTrip = data.reduce<Record<string, typeof data>>((acc, item) => {
      acc[item.tripId] = acc[item.tripId] ?? [];
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      acc[item.tripId]!.push(item)
      return acc
    }, {})

    return NextResponse.json(ok(data, { total: data.length, byTrip }))
  } catch (error) {
    console.error('[catalog/transport]', error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
