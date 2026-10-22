import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { hajiProductUpdateSchema } from '@/lib/validators/adminUpdates'
import { emptyToNull } from '@/lib/validators/richText'
import { isRecordNotFound } from '@/lib/admin/errors'

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireManager()
    const { id } = await params
    const parsed = hajiProductUpdateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    // Kuota total tidak boleh di bawah yang sudah dipesan/ditahan — pendingQuota/bookedQuota milik mesin booking.
    if (parsed.data.totalQuota !== undefined) {
      const current = await prisma.hajiProduct.findUnique({ where: { id }, select: { pendingQuota: true, bookedQuota: true } })
      if (!current) return NextResponse.json(err('Produk haji tidak ditemukan'), { status: 404 })
      if (parsed.data.totalQuota < current.pendingQuota + current.bookedQuota) {
        return NextResponse.json(err('Kuota total tidak boleh lebih kecil dari kuota yang sudah dipesan/ditahan'), { status: 409 })
      }
    }

    const { description, ...fields } = parsed.data
    return NextResponse.json(ok(await prisma.hajiProduct.update({
      where: { id },
      data: { ...fields, ...(description !== undefined && { description: emptyToNull(description) }) },
    })))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (e && typeof e === 'object' && (e as { code?: string }).code === 'P2025') {
      return NextResponse.json(err('Produk haji tidak ditemukan'), { status: 404 })
    }
    console.error('[admin/products/haji/[id]/PUT]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireManager()
    const { id } = await params
    await prisma.hajiProduct.update({ where: { id }, data: { isActive: false } })
    return NextResponse.json(ok(null))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Produk haji tidak ditemukan'), { status: 404 })
    console.error('[admin/products/haji/[id]/DELETE]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
