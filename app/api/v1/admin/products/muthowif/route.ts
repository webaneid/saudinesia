import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { activeFilter, paginateCatalog, pickParam, readCatalogQuery } from '@/lib/admin/catalogQuery'
import { escapeLike } from '@/lib/utils/search'
import { z } from 'zod'
import { emptyToNull, richTextField } from '@/lib/validators/richText'

// Harga TIDAK ada di sini secara sengaja — sekarang milik MuthowifServicePrice, satu layanan
// flat, bukan per-orang (docs/arsitektur-muthowif.md §9).
const createSchema = z.object({
  name:          z.string().min(1),
  bio:           richTextField().nullish(), // teks kaya, docs/arsitektur-editor-teks.md
  languages:     z.array(z.string()).default([]),
  dailyCapacity: z.coerce.number().int().positive().default(50),
  isActive:      z.boolean().default(true),
})

export async function GET(req: Request) {
  try {
    await requireManager()
    const cq = readCatalogQuery(new URL(req.url).searchParams)
    const where = { ...activeFilter(cq.status), ...(cq.q ? { name: { contains: escapeLike(cq.q), mode: 'insensitive' as const } } : {}) }
    const { items, meta } = await paginateCatalog(cq.list, () => prisma.muthowif.count({ where }), range => prisma.muthowif.findMany({ where, orderBy: [{ rating: 'desc' }, { id: 'asc' }], ...range }))
    return NextResponse.json(ok(items, meta))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/muthowif/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await requireManager()
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const m = await prisma.muthowif.create({ data: { ...parsed.data, bio: emptyToNull(parsed.data.bio) } })
    return NextResponse.json(ok(m), { status: 201 })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/muthowif/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
