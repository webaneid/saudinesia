import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { refreshTourPackagePriceCache } from '@/lib/pricing/refreshTourPackagePriceCache'
import { simulateSellPrice } from '@/lib/pricing/simulateSellPrice'
import { z } from 'zod'

const FLAT_TIER = { minDays: 0, maxDays: 9999 }
type CostTier = { minDays: number; maxDays: number; cost: number }

// Komponen biaya BEBAS (guide, makan, minum, tiket masuk, dst) — costComponent nama bebas
// teks, admin bisa tambah sebanyak apa pun (docs/arsitektur-ziarah.md §8.3).
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
    const { id: tourPackageId } = await params
    const costs = await prisma.productCost.findMany({
      where: { productType: 'tour_package', productId: tourPackageId, isActive: true },
      include: { vendor: { select: { id: true, name: true } } },
      orderBy: { costComponent: 'asc' },
    })
    // hppRupiah/sellPrice disertakan di sini (bukan cuma di /breakdown) supaya setiap baris
    // langsung tampil dengan harga terhitung — pola sama Visa/Transport/Hotel yang menampilkan
    // harga per-baris, bukan di tabel terpisah.
    const data = await Promise.all(costs.map(async (c) => {
      const cost = (c.costTiers as unknown as CostTier[])[0]?.cost ?? 0
      const preview = await simulateSellPrice('tour_package', [{ currency: c.currency, cost }])
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
    console.error('[admin/products/tour-packages/[id]/costs/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireSuperAdmin()
    const { id: tourPackageId } = await params
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const { costComponent, vendorId, currency, cost } = parsed.data

    const costTiers: CostTier[] = [{ ...FLAT_TIER, cost }]
    const created = await prisma.productCost.create({
      data: { productType: 'tour_package', productId: tourPackageId, costComponent, vendorId, currency, costTiers },
    })

    await refreshTourPackagePriceCache(tourPackageId)

    return NextResponse.json(ok(created), { status: 201 })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/tour-packages/[id]/costs/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
