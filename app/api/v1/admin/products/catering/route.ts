import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { activeFilter, paginateCatalog, pickParam, readCatalogQuery } from '@/lib/admin/catalogQuery'
import { escapeLike } from '@/lib/utils/search'
import { cateringOptionCreateSchema } from '@/lib/validators/adminUpdates'
import { emptyToNull } from '@/lib/validators/richText'
import { setManualSell } from '@/lib/pricing/engine'
import { cateringSeasonPrices } from '@/lib/pricing/engine/read'
import { CATERING_SEASONS, cateringVariantKey } from '@/lib/pricing/engine/owners/manualOnly'

function authError(e: unknown): NextResponse | null {
  return e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')
    ? NextResponse.json(err('Forbidden'), { status: 403 })
    : null
}

export async function GET(req: Request) {
  try {
    await requireManager()
    const cq = readCatalogQuery(new URL(req.url).searchParams)
    const where = { ...activeFilter(cq.status), ...(cq.q ? { name: { contains: escapeLike(cq.q), mode: 'insensitive' as const } } : {}) }
    const { items: rows, meta } = await paginateCatalog(cq.list, () => prisma.cateringOption.count({ where }), range => prisma.cateringOption.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...range }))
    const prices = await cateringSeasonPrices(rows.map(r => r.id))
    return NextResponse.json(ok(rows.map(r => ({ ...r, pricePerPersonRegular: prices.get(r.id)?.regular ?? 0, pricePerPersonRamadan: prices.get(r.id)?.ramadan ?? 0, pricePerPersonHajj: prices.get(r.id)?.hajj ?? 0 })), meta))
  } catch (e) {
    const a = authError(e); if (a) return a
    console.error('[admin/products/catering/GET]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireManager()
    const parsed = cateringOptionCreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const c = await prisma.cateringOption.create({
      data: { ...parsed.data, description: emptyToNull(parsed.data.description) },
    })
    // Harga awal dari formulir → titik harga (harga manual, tercatat atas nama pembuat). Musim berharga 0 = belum berharga (tak ada titik).
    const initial = { regular: parsed.data.pricePerPersonRegular, ramadan: parsed.data.pricePerPersonRamadan, hajj: parsed.data.pricePerPersonHajj }
    for (const season of CATERING_SEASONS) {
      if (initial[season] > 0) await setManualSell({ ownerType: 'catering', ownerId: c.id, variantKey: cateringVariantKey(season), sellIdr: initial[season], note: 'Harga awal saat paket dibuat', byUserId: session.userId })
    }
    return NextResponse.json(ok(c), { status: 201 })
  } catch (e) {
    const a = authError(e); if (a) return a
    console.error('[admin/products/catering/POST]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
