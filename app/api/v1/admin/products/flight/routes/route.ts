import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { activeFilter, paginateCatalog, pickParam, readCatalogQuery } from '@/lib/admin/catalogQuery'
import { escapeLike } from '@/lib/utils/search'
import { z } from 'zod'

const createSchema = z.object({
  origin:      z.string().min(1),
  destination: z.string().min(1),
  isActive:    z.boolean().default(true),
})

export async function GET(req: Request) {
  try {
    await requireManager()
    const cq = readCatalogQuery(new URL(req.url).searchParams)
    const like = { contains: escapeLike(cq.q), mode: 'insensitive' as const }
    const where = { ...activeFilter(cq.status), ...(cq.q ? { OR: [{ origin: like }, { destination: like }] } : {}) }
    const { items: routes, meta } = await paginateCatalog(cq.list, () => prisma.flightRoute.count({ where }), range => prisma.flightRoute.findMany({
      where,
      orderBy: [{ origin: 'asc' }, { destination: 'asc' }, { id: 'asc' }],
      ...range,
    }))
    return NextResponse.json(ok(routes, meta))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/flight/routes/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await requireManager()
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const route = await prisma.flightRoute.create({ data: parsed.data })
    return NextResponse.json(ok(route), { status: 201 })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/flight/routes/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
