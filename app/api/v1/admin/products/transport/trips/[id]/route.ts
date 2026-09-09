import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { z } from 'zod'

const updateSchema = z.object({
  name:        z.string().min(1).optional(),
  category:    z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  origin:      z.string().min(1).optional(),
  destination: z.string().min(1).optional(),
  isActive:    z.boolean().optional(),
})

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const trip = await prisma.transportTrip.findUnique({
      where: { id },
      include: {
        pricing: {
          include: { vehicle: true },
          orderBy: { vehicle: { vehicleType: 'asc' } },
        },
      },
    })
    if (!trip) return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
    return NextResponse.json(ok(trip))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/transport/trips/[id]/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const parsed = updateSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const trip = await prisma.transportTrip.update({ where: { id }, data: parsed.data })
    return NextResponse.json(ok(trip))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/transport/trips/[id]/PUT]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    await prisma.transportTrip.delete({ where: { id } })
    return NextResponse.json(ok(null))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/transport/trips/[id]/DELETE]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
