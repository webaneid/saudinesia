import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { activeFilter, paginateCatalog, pickParam, readCatalogQuery } from '@/lib/admin/catalogQuery'
import { escapeLike } from '@/lib/utils/search'
import { z } from 'zod'
import { emptyToNull, richTextField } from '@/lib/validators/richText'
import { isAuthError } from '@/lib/admin/errors'
import { withAdminPrices } from '@/lib/pricing/engine/adminRead'
import { canViewCost } from '@/lib/pricing/policy'

// price TIDAK ada di sini secara sengaja — cache dari computePackageBreakdown()
// (docs/arsitektur-paket-umroh.md §5), diisi lewat komponen biaya/mode di package builder,
// bukan diketik manual lagi (menutup Gap #5 docs/arsitektur-ziarah.md §6). Mode 6 komponen
// (hotel Makkah/Madinah/transport/muthowif/visa/flight/catering) dikonfigurasi belakangan
// di builder, sama pola dengan TourPackage.
const createSchema = z.object({
  name:        z.string().min(1),
  description: richTextField().nullish(), // teks kaya, docs/arsitektur-editor-teks.md
  priceLabel:  z.string().optional(),
  highlights:  z.array(z.string()).default([]),
  isFeatured:  z.boolean().default(false),
  isActive:    z.boolean().default(true),
})

export async function GET(req: Request) {
  try {
    const session = await requireManager()
    const cq = readCatalogQuery(new URL(req.url).searchParams)
    const where = { ...activeFilter(cq.status), ...(cq.q ? { name: { contains: escapeLike(cq.q), mode: 'insensitive' as const } } : {}) }
    const { items, meta } = await paginateCatalog(cq.list, () => prisma.package.count({ where }), range => prisma.package.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...range }))
    return NextResponse.json(ok(await withAdminPrices('package', items, { includeCost: canViewCost(session.role) }), meta))
  } catch (e) {
    if (isAuthError(e)) return NextResponse.json(err('Forbidden'), { status: 403 })
    console.error('[admin/products/packages/GET]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await requireManager()
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const { highlights, ...rest } = parsed.data
    const p = await prisma.package.create({ data: { ...rest, description: emptyToNull(rest.description), highlights } })
    return NextResponse.json(ok(p), { status: 201 })
  } catch (e) {
    if (isAuthError(e)) return NextResponse.json(err('Forbidden'), { status: 403 })
    console.error('[admin/products/packages/POST]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
