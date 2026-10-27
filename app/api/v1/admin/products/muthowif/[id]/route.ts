import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { isRecordNotFound } from '@/lib/admin/errors'
import { z } from 'zod'
import { emptyToNull, richTextField } from '@/lib/validators/richText'
import { deleteMuthowif } from '@/lib/admin/productDelete'

const updateSchema = z.object({
  name:          z.string().min(1).optional(),
  bio:           richTextField().nullish(), // teks kaya, docs/arsitektur-editor-teks.md
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
    return NextResponse.json(ok(m))
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
    const parsed = updateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const { bio, ...fields } = parsed.data
    const m = await prisma.muthowif.update({
      where: { id },
      data: { ...fields, ...(bio !== undefined && { bio: emptyToNull(bio) }) },
    })
    return NextResponse.json(ok(m))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Muthowif tidak ditemukan'), { status: 404 })
    console.error('[admin/products/muthowif/[id]/PUT]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

// Hapus sungguhan hanya bila tak ada riwayat yang merujuk; selain itu nonaktif (lib/admin/productDelete.ts).
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    return NextResponse.json(ok(await deleteMuthowif(id)))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Muthowif tidak ditemukan'), { status: 404 })
    console.error('[admin/products/muthowif/[id]/DELETE]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
