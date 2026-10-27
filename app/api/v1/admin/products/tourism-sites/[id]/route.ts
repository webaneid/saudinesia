import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { isRecordNotFound } from '@/lib/admin/errors'
import { z } from 'zod'
import { emptyToNull, richTextField } from '@/lib/validators/richText'
import { deleteTourismSite } from '@/lib/admin/productDelete'

const updateSchema = z.object({
  name:        z.string().min(1).optional(),
  city:        z.string().nullable().optional(),
  description: richTextField().nullish(), // teks kaya, docs/arsitektur-editor-teks.md
  gmapsUrl:    z.string().url().nullable().optional().or(z.literal('')),
  isActive:    z.boolean().optional(),
})

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const site = await prisma.tourismSite.findUnique({ where: { id } })
    if (!site) return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
    return NextResponse.json(ok(site))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/tourism-sites/[id]/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const parsed = updateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const { description, ...fields } = parsed.data
    const site = await prisma.tourismSite.update({
      where: { id },
      data: { ...fields, ...(description !== undefined && { description: emptyToNull(description) }) },
    })
    return NextResponse.json(ok(site))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Situs wisata tidak ditemukan'), { status: 404 })
    console.error('[admin/products/tourism-sites/[id]/PUT]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

// Hapus sungguhan hanya bila tak ada riwayat yang merujuk; selain itu nonaktif (lib/admin/productDelete.ts).
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    return NextResponse.json(ok(await deleteTourismSite(id)))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Situs wisata tidak ditemukan'), { status: 404 })
    console.error('[admin/products/tourism-sites/[id]/DELETE]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
