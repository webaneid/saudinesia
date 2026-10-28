import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { activeFilter, paginateCatalog, pickParam, readCatalogQuery } from '@/lib/admin/catalogQuery'
import { escapeLike } from '@/lib/utils/search'
import { hajiProductCreateSchema } from '@/lib/validators/adminUpdates'
import { emptyToNull } from '@/lib/validators/richText'
import { withAdminPrices } from '@/lib/pricing/engine/adminRead'
import { canViewCost } from '@/lib/pricing/policy'

export async function GET(req: Request) {
  try {
    const session = await requireManager()
    const cq = readCatalogQuery(new URL(req.url).searchParams)
    const type = pickParam(cq.params, 'type', ['furoda', 'khusus', 'reguler'] as const)
    const where = { ...activeFilter(cq.status), ...(type ? { hajiType: type } : {}), ...(cq.q ? { name: { contains: escapeLike(cq.q), mode: 'insensitive' as const } } : {}) }
    const { items, meta } = await paginateCatalog(cq.list, () => prisma.hajiProduct.count({ where }), range => prisma.hajiProduct.findMany({ where, orderBy: [{ year: 'asc' }, { id: 'asc' }], ...range }))
    return NextResponse.json(ok(await withAdminPrices('haji', items, { includeCost: canViewCost(session.role) }), meta))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/haji/GET]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await requireManager()
    const parsed = hajiProductCreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const { description, ...d } = parsed.data
    const p = await prisma.hajiProduct.create({
      // Belum ada titik harga = "belum ditetapkan" sampai Komponen Biaya diisi (tidak bisa dipesan — SEC-66).
      data: { ...d, description: emptyToNull(description), priceLabel: 'per orang' },
    })
    return NextResponse.json(ok(p), { status: 201 })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/haji/POST]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
