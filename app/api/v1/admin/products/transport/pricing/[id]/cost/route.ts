import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { refreshTransportPricingCache } from '@/lib/pricing/refreshTransportPricingCache'
import { z } from 'zod'

// Transport punya persis 1 komponen HPP tetap, tidak day-based — pola identik Flight
// (docs/arsitektur-transportasi.md §9.4).
const COMPONENT_KENDARAAN = 'kendaraan'
const FLAT_TIER = { minDays: 0, maxDays: 9999 }

type CostTier = { minDays: number; maxDays: number; cost: number }

const putSchema = z.object({
  vendorId: z.string().min(1),
  currency: z.string().min(1),
  hargaKendaraan: z.coerce.number().positive(),
})

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireSuperAdmin()
    const { id } = await params

    const cost = await prisma.productCost.findFirst({
      where: { productType: 'transport', productId: id, costComponent: COMPONENT_KENDARAAN, isActive: true },
    })
    const tiers = (cost?.costTiers as unknown as CostTier[]) ?? []
    const hargaKendaraan = tiers[0]?.cost ?? null

    return NextResponse.json(ok({
      vendorId: cost?.vendorId ?? null,
      currency: cost?.currency ?? null,
      hargaKendaraan,
    }))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/transport/pricing/[id]/cost/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireSuperAdmin()
    const { id } = await params
    const parsed = putSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const { vendorId, currency, hargaKendaraan } = parsed.data

    const costTiers: CostTier[] = [{ ...FLAT_TIER, cost: hargaKendaraan }]

    const existing = await prisma.productCost.findFirst({
      where: { productType: 'transport', productId: id, costComponent: COMPONENT_KENDARAAN },
    })

    if (existing) {
      await prisma.productCost.update({
        where: { id: existing.id },
        data: { vendorId, currency, costTiers, isActive: true },
      })
    } else {
      await prisma.productCost.create({
        data: { productType: 'transport', productId: id, costComponent: COMPONENT_KENDARAAN, vendorId, currency, costTiers },
      })
    }

    await prisma.preferredVendor.upsert({
      where: { productType_productId_costComponent: { productType: 'transport', productId: id, costComponent: COMPONENT_KENDARAAN } },
      create: { productType: 'transport', productId: id, costComponent: COMPONENT_KENDARAAN, vendorId },
      update: { vendorId },
    })

    await refreshTransportPricingCache(id)

    return NextResponse.json(ok({ vendorId, currency, hargaKendaraan }))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/transport/pricing/[id]/cost/PUT]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
