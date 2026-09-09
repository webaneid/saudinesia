import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { refreshPackagePriceCache } from '@/lib/pricing/refreshPackagePriceCache'
import { simulateSellPrice } from '@/lib/pricing/simulateSellPrice'
import { z } from 'zod'

const FLAT_TIER = { minDays: 0, maxDays: 9999 }
type CostTier = { minDays: number; maxDays: number; cost: number }

// Komponen biaya BEBAS (dokumen, admin fee, dst) — costComponent nama bebas teks, dipakai
// mengkalibrasi HPP paket presisi (docs/arsitektur-paket-umroh.md §3).
const createSchema = z.object({
  costComponent: z.string().min(1),
  vendorId:      z.string().min(1),
  currency:      z.string().min(1),
  cost:          z.coerce.number().positive(),
})

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireSuperAdmin()
    const { id: packageId } = await params
    const costs = await prisma.productCost.findMany({
      where: { productType: 'package', productId: packageId, isActive: true },
      include: { vendor: { select: { id: true, name: true } } },
      orderBy: { costComponent: 'asc' },
    })
    const data = await Promise.all(costs.map(async (c) => {
      const cost = (c.costTiers as unknown as CostTier[])[0]?.cost ?? 0
      const preview = await simulateSellPrice('package', [{ currency: c.currency, cost }])
      return {
        id: c.id, costComponent: c.costComponent, vendorId: c.vendorId, vendorName: c.vendor.name,
        currency: c.currency, cost,
        hppRupiah: preview?.hppRupiah ?? null, sellPrice: preview?.sellPrice ?? null,
      }
    }))
    return NextResponse.json(ok(data))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/packages/[id]/costs/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireSuperAdmin()
    const { id: packageId } = await params
    const parsed = createSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const { costComponent, vendorId, currency, cost } = parsed.data

    const costTiers: CostTier[] = [{ ...FLAT_TIER, cost }]
    const created = await prisma.productCost.create({
      data: { productType: 'package', productId: packageId, costComponent, vendorId, currency, costTiers },
    })

    await refreshPackagePriceCache(packageId)

    return NextResponse.json(ok(created), { status: 201 })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/packages/[id]/costs/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
