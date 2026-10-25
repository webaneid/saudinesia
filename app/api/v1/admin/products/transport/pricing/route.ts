import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { z } from 'zod'

// price TIDAK ada di sini secara sengaja (docs/arsitektur-transportasi.md §9, pola sama Flight) —
// kombinasi rute×kendaraan baru dibuat dengan price:0, terisi otomatis setelah admin mengisi
// komponen HPP lewat endpoint .../[id]/cost.
const createSchema = z.object({
  tripId:    z.string().min(1),
  vehicleId: z.string().min(1),
})

export async function GET() {
  try {
    await requireManager()
    const pricing = await prisma.transportPricing.findMany({
      include: {
        trip:    { select: { id: true, name: true, category: true } },
        vehicle: { select: { id: true, name: true, vehicleType: true, capacity: true } },
      },
      orderBy: [{ trip: { name: 'asc' } }, { vehicle: { vehicleType: 'asc' } }],
    })
    return NextResponse.json(ok(pricing))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/transport/pricing/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await requireManager()
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const existing = await prisma.transportPricing.findUnique({
      where: { tripId_vehicleId: { tripId: parsed.data.tripId, vehicleId: parsed.data.vehicleId } },
    })
    if (existing) return NextResponse.json(err('Kombinasi trip + kendaraan sudah ada'), { status: 409 })

    const pricing = await prisma.transportPricing.create({
      data: { ...parsed.data, price: 0 },
      include: {
        trip:    { select: { id: true, name: true, category: true } },
        vehicle: { select: { id: true, name: true, vehicleType: true, capacity: true } },
      },
    })
    return NextResponse.json(ok(pricing), { status: 201 })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/transport/pricing/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
