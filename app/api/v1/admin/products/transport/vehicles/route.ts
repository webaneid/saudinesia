import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { activeFilter, paginateCatalog, pickParam, readCatalogQuery } from '@/lib/admin/catalogQuery'
import { escapeLike } from '@/lib/utils/search'
import { z } from 'zod'

const createSchema = z.object({
  name:        z.string().min(1),
  vehicleType: z.string().min(1),
  capacity:    z.coerce.number().int().positive(),
  fleetCount:  z.coerce.number().int().positive().default(1),
  description: z.string().optional(),
  isActive:    z.boolean().default(true),
})

export async function GET(req: Request) {
  try {
    await requireManager()
    const cq = readCatalogQuery(new URL(req.url).searchParams)
    const where = { ...activeFilter(cq.status), ...(cq.q ? { name: { contains: escapeLike(cq.q), mode: 'insensitive' as const } } : {}) }
    const { items, meta } = await paginateCatalog(cq.list, () => prisma.transportVehicle.count({ where }), range => prisma.transportVehicle.findMany({ where, orderBy: [{ vehicleType: 'asc' }, { name: 'asc' }, { id: 'asc' }], ...range }))
    return NextResponse.json(ok(items, meta))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/transport/vehicles/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await requireManager()
    const body = await req.json().catch(() => null)
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const v = await prisma.transportVehicle.create({ data: parsed.data })
    return NextResponse.json(ok(v), { status: 201 })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/transport/vehicles/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
