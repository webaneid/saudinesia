import { purgeProductMedia } from '@/lib/media/service'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { cateringOptionUpdateSchema } from '@/lib/validators/adminUpdates'
import { emptyToNull } from '@/lib/validators/richText'
import { authFailureResponse, isRecordNotFound } from '@/lib/admin/errors'
import { deleteOrDeactivate } from '@/lib/admin/safeDelete'

type Ctx = { params: Promise<{ id: string }> }
const notFound = () => NextResponse.json(err('Paket katering tidak ditemukan'), { status: 404 })

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const c = await prisma.cateringOption.findUnique({ where: { id } })
    return c ? NextResponse.json(ok(c)) : notFound()
  } catch (e) {
    return authFailureResponse(e, 'admin/products/catering/[id]/GET')
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const parsed = cateringOptionUpdateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const { description, ...rest } = parsed.data
    const c = await prisma.cateringOption.update({
      where: { id },
      data: { ...rest, ...(description !== undefined ? { description: emptyToNull(description) } : {}) },
    })
    return NextResponse.json(ok(c))
  } catch (e) {
    if (isRecordNotFound(e)) return notFound()
    return authFailureResponse(e, 'admin/products/catering/[id]/PUT')
  }
}

// Hapus sungguhan hanya bila tak dirujuk booking maupun Paket Umroh (opsi/terkunci); selain itu nonaktif.
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const result = await deleteOrDeactivate({
      references: async () => {
        const row = await prisma.cateringOption.findUnique({ where: { id }, select: { _count: { select: { bookingCatering: true, includedInPackages: true, packageOptions: true } } } })
        if (!row) throw Object.assign(new Error('not found'), { code: 'P2025' })
        return row._count.bookingCatering + row._count.includedInPackages + row._count.packageOptions
      },
      remove: async () => { await prisma.cateringOption.delete({ where: { id } }); await purgeProductMedia('catering', id) },
      deactivate: () => prisma.cateringOption.update({ where: { id }, data: { isActive: false } }),
      usedBy: n => `Paket katering dipakai di ${n} booking/paket`,
    })
    return NextResponse.json(ok(result))
  } catch (e) {
    if (isRecordNotFound(e)) return notFound()
    return authFailureResponse(e, 'admin/products/catering/[id]/DELETE')
  }
}
