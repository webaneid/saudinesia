import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { seasonUpdateSchema } from '@/lib/validators/adminUpdates'
import { authFailureResponse, isRecordNotFound } from '@/lib/admin/errors'

type Ctx = { params: Promise<{ id: string }> }
const notFound = () => NextResponse.json(err('Musim tidak ditemukan'), { status: 404 })

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const s = await prisma.season.findUnique({ where: { id } })
    return s ? NextResponse.json(ok(s)) : notFound()
  } catch (e) {
    return authFailureResponse(e, 'admin/products/seasons/[id]/GET')
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const parsed = seasonUpdateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    // Urutan tanggal diperiksa terhadap nilai tersimpan bila hanya salah satu tanggal yang dikirim.
    const current = await prisma.season.findUnique({ where: { id } })
    if (!current) return notFound()
    const start = parsed.data.startDate ?? current.startDate
    const end = parsed.data.endDate ?? current.endDate
    if (end < start) return NextResponse.json(err('Tanggal akhir tidak boleh sebelum tanggal mulai'), { status: 400 })
    const s = await prisma.season.update({ where: { id }, data: parsed.data })
    return NextResponse.json(ok(s))
  } catch (e) {
    if (isRecordNotFound(e)) return notFound()
    return authFailureResponse(e, 'admin/products/seasons/[id]/PUT')
  }
}

export async function DELETE(_: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    await prisma.season.delete({ where: { id } })
    return NextResponse.json(ok({ deleted: true }))
  } catch (e) {
    if (isRecordNotFound(e)) return notFound()
    return authFailureResponse(e, 'admin/products/seasons/[id]/DELETE')
  }
}
