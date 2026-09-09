import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { z } from 'zod'

const createSchema = z.object({
  name:        z.string().min(1),
  vehicleType: z.string().min(1),
  capacity:    z.coerce.number().int().positive(),
  fleetCount:  z.coerce.number().int().positive().default(1),
  description: z.string().optional(),
  isActive:    z.boolean().default(true),
})

export async function GET() {
  try {
    await requireManager()
    return NextResponse.json(ok(await prisma.transportVehicle.findMany({ orderBy: { vehicleType: 'asc' } })))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/transport/vehicles/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await requireManager()
    const body = await req.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const v = await prisma.transportVehicle.create({ data: parsed.data })
    return NextResponse.json(ok(v), { status: 201 })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/transport/vehicles/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
