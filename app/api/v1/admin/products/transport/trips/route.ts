import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { z } from 'zod'

// origin/destination wajib — struktur rute meniru FlightRoute (docs/arsitektur-transportasi.md §9.1)
const createSchema = z.object({
  name:        z.string().min(1),
  category:    z.string().nullish(), // formulir terkontrol mengirim null untuk kolom kosong (pelajaran .optional() vs .nullish())
  description: z.string().optional(),
  origin:      z.string().min(1),
  destination: z.string().min(1),
  isActive:    z.boolean().default(true),
})

export async function GET() {
  try {
    await requireManager()
    const trips = await prisma.transportTrip.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      include: {
        pricing: {
          include: { vehicle: { select: { id: true, name: true, vehicleType: true, capacity: true } } },
        },
      },
    })
    return NextResponse.json(ok(trips))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/transport/trips/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await requireManager()
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const trip = await prisma.transportTrip.create({ data: parsed.data })
    return NextResponse.json(ok(trip), { status: 201 })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/transport/trips/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
