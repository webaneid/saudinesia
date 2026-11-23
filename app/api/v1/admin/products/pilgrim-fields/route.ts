import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { authFailureResponse } from '@/lib/admin/errors'
import { activeFilter, paginateCatalog, readCatalogQuery } from '@/lib/admin/catalogQuery'
import { escapeLike } from '@/lib/utils/search'
import { pilgrimFieldCreateSchema } from '@/lib/validators/pilgrimFields'
import { createPilgrimField, PILGRIM_FIELD_SELECT } from '@/lib/pilgrim-data/fields'

// Katalog Data Jamaah (docs/arsitektur-data-jamaah.md §3.1, D2) — manager+, pola sama Jenis Dokumen.

export async function GET(req: Request) {
  try {
    await requireManager()
    const cq = readCatalogQuery(new URL(req.url).searchParams)
    const like = { contains: escapeLike(cq.q), mode: 'insensitive' as const }
    const where = { ...activeFilter(cq.status), ...(cq.q ? { OR: [{ label: like }, { key: like }] } : {}) }
    const { items, meta } = await paginateCatalog(cq.list, () => prisma.pilgrimField.count({ where }), range => prisma.pilgrimField.findMany({
      where, orderBy: [{ order: 'asc' }, { label: 'asc' }, { id: 'asc' }], ...range, select: PILGRIM_FIELD_SELECT,
    }))
    return NextResponse.json(ok(items, meta))
  } catch (e) {
    return authFailureResponse(e, 'admin/products/pilgrim-fields/GET')
  }
}

export async function POST(req: Request) {
  try {
    await requireManager()
    const parsed = pilgrimFieldCreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return NextResponse.json({ ...err(issue?.message ?? 'Data tidak valid'), ...(issue?.path.length ? { meta: { field: issue.path.join('.') } } : {}) }, { status: 400 })
    }
    const r = await createPilgrimField(parsed.data)
    if (!r.ok) return NextResponse.json({ ...err(r.error), ...(r.field ? { meta: { field: r.field } } : {}) }, { status: r.status })
    return NextResponse.json(ok(r.value), { status: 201 })
  } catch (e) {
    return authFailureResponse(e, 'admin/products/pilgrim-fields/POST')
  }
}
