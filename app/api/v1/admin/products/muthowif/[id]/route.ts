import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { getPresignedUrl } from '@/lib/storage/minio'
import { ok, err } from '@/lib/validators'
import { z } from 'zod'

const updateSchema = z.object({
  name:          z.string().min(1).optional(),
  bio:           z.string().nullable().optional(),
  languages:     z.array(z.string()).optional(),
  dailyCapacity: z.coerce.number().int().positive().optional(),
  isActive:      z.boolean().optional(),
})

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const m = await prisma.muthowif.findUnique({ where: { id } })
    if (!m) return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
    const photoUrl = m.photoKey ? await getPresignedUrl(m.photoKey, 3600).catch(() => null) : null
    return NextResponse.json(ok({ ...m, photoUrl }))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/muthowif/[id]/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

// Tidak ada DELETE — dipakai histori BookingMuthowif, nonaktifkan via isActive (pola sama modul lain).
export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const parsed = updateSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const m = await prisma.muthowif.update({ where: { id }, data: parsed.data })
    return NextResponse.json(ok(m))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/muthowif/[id]/PUT]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
