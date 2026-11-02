import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { authFailureResponse } from '@/lib/admin/errors'
import { activeFilter, paginateCatalog, readCatalogQuery } from '@/lib/admin/catalogQuery'
import { escapeLike } from '@/lib/utils/search'
import { documentTypeCreateSchema } from '@/lib/validators/documents'
import { createDocumentType } from '@/lib/documents/types'

// Katalog jenis dokumen (docs/arsitektur-jamaah.md §7.1) — manager+ (§9, selaras editor produk).

export async function GET(req: Request) {
  try {
    await requireManager()
    const cq = readCatalogQuery(new URL(req.url).searchParams)
    const like = { contains: escapeLike(cq.q), mode: 'insensitive' as const }
    const where = { ...activeFilter(cq.status), ...(cq.q ? { OR: [{ label: like }, { key: like }] } : {}) }
    const { items, meta } = await paginateCatalog(cq.list, () => prisma.documentType.count({ where }), range => prisma.documentType.findMany({
      where, orderBy: [{ order: 'asc' }, { label: 'asc' }, { id: 'asc' }], ...range,
      select: { id: true, key: true, label: true, icon: true, reusable: true, hasExpiry: true, allowMultiple: true, isSystem: true, isActive: true, order: true, _count: { select: { documents: true } } },
    }))
    return NextResponse.json(ok(items, meta))
  } catch (e) {
    return authFailureResponse(e, 'admin/products/document-types/GET')
  }
}

export async function POST(req: Request) {
  try {
    await requireManager()
    const parsed = documentTypeCreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return NextResponse.json({ ...err(issue?.message ?? 'Data tidak valid'), ...(issue?.path.length ? { meta: { field: issue.path.join('.') } } : {}) }, { status: 400 })
    }
    const r = await createDocumentType(parsed.data)
    if (!r.ok) return NextResponse.json({ ...err(r.error), ...(r.field ? { meta: { field: r.field } } : {}) }, { status: r.status })
    return NextResponse.json(ok(r.value), { status: 201 })
  } catch (e) {
    return authFailureResponse(e, 'admin/products/document-types/POST')
  }
}
