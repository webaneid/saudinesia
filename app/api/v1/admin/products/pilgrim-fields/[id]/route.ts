import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { authFailureResponse, isRecordNotFound } from '@/lib/admin/errors'
import { pilgrimFieldUpdateSchema } from '@/lib/validators/pilgrimFields'
import { deletePilgrimField, fieldUsage, PILGRIM_FIELD_SELECT, updatePilgrimField } from '@/lib/pilgrim-data/fields'

// Satu kolom katalog Data Jamaah (docs/arsitektur-data-jamaah.md §3.1, D2) — manager+, pola sama Jenis Dokumen.

type Ctx = { params: Promise<{ id: string }> }

const idSchema = z.string().uuid()
const notFound = () => NextResponse.json(err('Kolom data jamaah tidak ditemukan'), { status: 404 })

/** Baris + jumlah pemakaian (jamaah booking / kartu yang sudah menyimpan nilai) — dasar kunci tipe dan hapus-aman di editor. */
async function load(id: string) {
  const row = await prisma.pilgrimField.findUnique({ where: { id }, select: PILGRIM_FIELD_SELECT })
  return row ? { ...row, usage: await fieldUsage(row.key) } : null
}

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const id = idSchema.safeParse((await params).id)
    if (!id.success) return notFound()
    const row = await load(id.data)
    return row ? NextResponse.json(ok(row)) : notFound()
  } catch (e) {
    return authFailureResponse(e, 'admin/products/pilgrim-fields/[id]/GET')
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const id = idSchema.safeParse((await params).id)
    if (!id.success) return notFound()
    const parsed = pilgrimFieldUpdateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return NextResponse.json({ ...err(issue?.message ?? 'Data tidak valid'), ...(issue?.path.length ? { meta: { field: issue.path.join('.') } } : {}) }, { status: 400 })
    }
    const r = await updatePilgrimField(id.data, parsed.data)
    if (!r.ok) return NextResponse.json({ ...err(r.error), ...(r.field ? { meta: { field: r.field } } : {}) }, { status: r.status })
    const row = await load(id.data)
    return row ? NextResponse.json(ok(row)) : notFound()
  } catch (e) {
    return authFailureResponse(e, 'admin/products/pilgrim-fields/[id]/PUT')
  }
}

// Hapus-aman: bawaan / sudah berisi data → nonaktif (bisa diaktifkan kembali), selain itu dihapus sungguhan. Nama Lengkap tak bisa keduanya.
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const id = idSchema.safeParse((await params).id)
    if (!id.success) return notFound()
    const row = await prisma.pilgrimField.findUnique({ where: { id: id.data }, select: { role: true } })
    if (!row) return notFound()
    if (row.role === 'display_name') return NextResponse.json(err('Nama Lengkap tidak bisa dihapus atau dinonaktifkan'), { status: 400 })
    return NextResponse.json(ok(await deletePilgrimField(id.data)))
  } catch (e) {
    if (isRecordNotFound(e)) return notFound()
    return authFailureResponse(e, 'admin/products/pilgrim-fields/[id]/DELETE')
  }
}
