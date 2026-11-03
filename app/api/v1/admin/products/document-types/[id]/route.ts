import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { authFailureResponse, isRecordNotFound } from '@/lib/admin/errors'
import { documentTypeUpdateSchema } from '@/lib/validators/documents'
import { deleteDocumentType, updateDocumentType } from '@/lib/documents/types'

type Ctx = { params: Promise<{ id: string }> }

const idSchema = z.string().uuid()
const notFound = () => NextResponse.json(err('Jenis dokumen tidak ditemukan'), { status: 404 })

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const id = idSchema.safeParse((await params).id)
    if (!id.success) return notFound()
    const row = await prisma.documentType.findUnique({ where: { id: id.data }, include: { _count: { select: { documents: true } } } })
    return row ? NextResponse.json(ok(row)) : notFound()
  } catch (e) {
    return authFailureResponse(e, 'admin/products/document-types/[id]/GET')
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const id = idSchema.safeParse((await params).id)
    if (!id.success) return notFound()
    const parsed = documentTypeUpdateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return NextResponse.json({ ...err(issue?.message ?? 'Data tidak valid'), ...(issue?.path.length ? { meta: { field: issue.path.join('.') } } : {}) }, { status: 400 })
    }
    const r = await updateDocumentType(id.data, parsed.data)
    if (!r.ok) return NextResponse.json({ ...err(r.error), ...(r.field ? { meta: { field: r.field } } : {}) }, { status: r.status })
    const row = await prisma.documentType.findUnique({ where: { id: id.data }, include: { _count: { select: { documents: true } } } })
    return row ? NextResponse.json(ok(row)) : notFound()
  } catch (e) {
    return authFailureResponse(e, 'admin/products/document-types/[id]/PUT')
  }
}

// Hapus-aman: bawaan / sudah dipakai → nonaktif (bisa diaktifkan kembali), selain itu dihapus sungguhan.
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const id = idSchema.safeParse((await params).id)
    if (!id.success) return notFound()
    return NextResponse.json(ok(await deleteDocumentType(id.data)))
  } catch (e) {
    if (isRecordNotFound(e)) return notFound()
    return authFailureResponse(e, 'admin/products/document-types/[id]/DELETE')
  }
}
