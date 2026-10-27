import { purgeProductMedia } from '@/lib/media/service'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { isRecordNotFound } from '@/lib/admin/errors'
import { deleteOrDeactivate } from '@/lib/admin/safeDelete'
import { z } from 'zod'

const updateSchema = z.object({
  name:        z.string().min(1).optional(),
  vehicleType: z.string().optional(),
  capacity:    z.coerce.number().int().positive().optional(),
  fleetCount:  z.coerce.number().int().positive().optional(),
  description: z.string().nullable().optional(),
  isActive:    z.boolean().optional(),
})

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const v = await prisma.transportVehicle.findUnique({ where: { id } })
    if (!v) return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
    return NextResponse.json(ok(v))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/transport/vehicles/[id]/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const parsed = updateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const v = await prisma.transportVehicle.update({ where: { id }, data: parsed.data })
    return NextResponse.json(ok(v))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Kendaraan tidak ditemukan'), { status: 404 })
    console.error('[admin/products/transport/vehicles/[id]/PUT]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

// Hapus sungguhan hanya bila kendaraan belum dipakai harga/trip mana pun; selain itu nonaktif.
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const result = await deleteOrDeactivate({
      references: async () => {
        const row = await prisma.transportVehicle.findUnique({ where: { id }, select: { _count: { select: { pricing: true } } } })
        if (!row) throw Object.assign(new Error('not found'), { code: 'P2025' })
        return row._count.pricing
      },
      remove: async () => { await prisma.transportVehicle.delete({ where: { id } }); await purgeProductMedia('vehicle', id) },
      deactivate: () => prisma.transportVehicle.update({ where: { id }, data: { isActive: false } }),
      usedBy: n => `Kendaraan dipakai di ${n} harga trip`,
    })
    return NextResponse.json(ok(result))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Kendaraan tidak ditemukan'), { status: 404 })
    console.error('[admin/products/transport/vehicles/[id]/DELETE]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
