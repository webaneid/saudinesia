import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { isRecordNotFound } from '@/lib/admin/errors'
import { deleteOrDeactivate } from '@/lib/admin/safeDelete'
import { z } from 'zod'

const updateSchema = z.object({
  origin:      z.string().trim().min(1).optional(),
  destination: z.string().trim().min(1).optional(),
  isActive:    z.boolean().optional(),
}).strict().refine(v => Object.keys(v).length > 0, { message: 'Tidak ada perubahan' })

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const route = await prisma.flightRoute.findUnique({ where: { id } })
    if (!route) return NextResponse.json(err('Rute penerbangan tidak ditemukan'), { status: 404 })
    return NextResponse.json(ok(route))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/flight/routes/[id]/GET]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

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

    // Hapus sungguhan hanya bila TIDAK dirujuk jadwal (aktif maupun nonaktif) atau Paket Umroh; selain itu nonaktif. Dulu hanya jadwal
    // AKTIF yang dihitung — rute yang dirujuk jadwal nonaktif/paket gagal dengan galat FK (500).
    const result = await deleteOrDeactivate({
      references: async () => {
        const row = await prisma.flightRoute.findUnique({ where: { id }, select: { _count: { select: { schedules: true, packages: true } } } })
        if (!row) throw Object.assign(new Error('not found'), { code: 'P2025' })
        return row._count.schedules + row._count.packages
      },
      remove: () => prisma.flightRoute.delete({ where: { id } }),
      deactivate: () => prisma.flightRoute.update({ where: { id }, data: { isActive: false } }),
      usedBy: n => `Rute dipakai oleh ${n} jadwal/paket`,
    })
    return NextResponse.json(ok(result))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Rute penerbangan tidak ditemukan'), { status: 404 })
    console.error('[admin/products/flight/routes/[id]/DELETE]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
