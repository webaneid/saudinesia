import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { isRecordNotFound } from '@/lib/admin/errors'
import { z } from 'zod'

const updateSchema = z.object({
  origin:      z.string().min(1).optional(),
  destination: z.string().min(1).optional(),
  isActive:    z.boolean().optional(),
})

type Ctx = { params: Promise<{ id: string }> }

export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const parsed = updateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const route = await prisma.flightRoute.update({ where: { id }, data: parsed.data })
    return NextResponse.json(ok(route))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Rute penerbangan tidak ditemukan'), { status: 404 })
    console.error('[admin/products/flight/routes/[id]/PUT]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params

    // Rute yang masih dipakai jadwal aktif — nonaktifkan (soft), bukan hapus fisik, supaya tidak
    // kena FK constraint. Pola sama dengan Vendor DELETE. docs/arsitektur-tiket-pesawat.md §9 poin 8.
    const activeSchedules = await prisma.flightSchedule.count({ where: { routeId: id, isActive: true } })
    if (activeSchedules > 0) {
      const route = await prisma.flightRoute.update({ where: { id }, data: { isActive: false } })
      return NextResponse.json(ok(route))
    }

    await prisma.flightRoute.delete({ where: { id } })
    return NextResponse.json(ok(null))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Rute penerbangan tidak ditemukan'), { status: 404 })
    console.error('[admin/products/flight/routes/[id]/DELETE]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
