import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { activeFilter, paginateCatalog, pickParam, readCatalogQuery } from '@/lib/admin/catalogQuery'
import { seasonCreateSchema } from '@/lib/validators/adminUpdates'
import { isAuthError } from '@/lib/admin/errors'

export async function GET(req: Request) {
  try {
    await requireManager()
    const cq = readCatalogQuery(new URL(req.url).searchParams)
    const { items, meta } = await paginateCatalog(cq.list, () => prisma.season.count(), range => prisma.season.findMany({ orderBy: [{ startDate: 'asc' }, { id: 'asc' }], ...range }))
    return NextResponse.json(ok(items, meta))
  } catch (e) {
    if (isAuthError(e)) return NextResponse.json(err('Forbidden'), { status: 403 })
    console.error('[admin/products/seasons/GET]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await requireManager()
    const parsed = seasonCreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const s = await prisma.season.create({ data: parsed.data })
    return NextResponse.json(ok(s), { status: 201 })
  } catch (e) {
    if (isAuthError(e)) return NextResponse.json(err('Forbidden'), { status: 403 })
    console.error('[admin/products/seasons/POST]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
