import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { isRecordNotFound } from '@/lib/admin/errors'
import { z } from 'zod'

const updateSchema = z.object({
  isActive: z.boolean().optional(),
})

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const pricing = await prisma.transportPricing.findUnique({
      where: { id },
      include: {
        trip:    { select: { id: true, name: true, category: true, origin: true, destination: true } },
        vehicle: { select: { id: true, name: true, vehicleType: true, capacity: true } },
      },
    })
    if (!pricing) return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
    return NextResponse.json(ok(pricing))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/transport/pricing/[id]/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const parsed = updateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const pricing = await prisma.transportPricing.update({ where: { id }, data: parsed.data })
    return NextResponse.json(ok(pricing))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Harga transport tidak ditemukan'), { status: 404 })
    console.error('[admin/products/transport/pricing/[id]/PUT]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    await prisma.transportPricing.delete({ where: { id } })
    await prisma.pricePoint.deleteMany({ where: { ownerType: 'transport', ownerId: id } }) // titik harga ikut (tanpa FK)
    return NextResponse.json(ok(null))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Harga transport tidak ditemukan'), { status: 404 })
    console.error('[admin/products/transport/pricing/[id]/DELETE]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
