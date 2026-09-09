import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { refreshFlightScheduleCache } from '@/lib/pricing/refreshFlightScheduleCache'
import { z } from 'zod'

// Flight punya persis 1 komponen HPP tetap (dikonfirmasi user 2026-07-19) — beda dari Visa
// yang butuh 2 (Harga Visa + Harga BRN). Lihat docs/arsitektur-tiket-pesawat.md §4.
const COMPONENT_TIKET = 'tiket'
const FLAT_TIER = { minDays: 0, maxDays: 9999 }

type CostTier = { minDays: number; maxDays: number; cost: number }

const putSchema = z.object({
  vendorId: z.string().min(1),
  currency: z.string().min(1),
  hargaTiket: z.coerce.number().positive(),
})

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireSuperAdmin()
    const { id } = await params

    const cost = await prisma.productCost.findFirst({
      where: { productType: 'flight', productId: id, costComponent: COMPONENT_TIKET, isActive: true },
    })
    const tiers = (cost?.costTiers as unknown as CostTier[]) ?? []
    const hargaTiket = tiers[0]?.cost ?? null

    return NextResponse.json(ok({
      vendorId: cost?.vendorId ?? null,
      currency: cost?.currency ?? null,
      hargaTiket,
    }))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/flight/schedules/[id]/cost/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireSuperAdmin()
    const { id } = await params
    const parsed = putSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const { vendorId, currency, hargaTiket } = parsed.data

    const costTiers: CostTier[] = [{ ...FLAT_TIER, cost: hargaTiket }]

    const existing = await prisma.productCost.findFirst({
      where: { productType: 'flight', productId: id, costComponent: COMPONENT_TIKET },
    })

    if (existing) {
      await prisma.productCost.update({
        where: { id: existing.id },
        data: { vendorId, currency, costTiers, isActive: true },
      })
    } else {
      await prisma.productCost.create({
        data: { productType: 'flight', productId: id, costComponent: COMPONENT_TIKET, vendorId, currency, costTiers },
      })
    }

    await prisma.preferredVendor.upsert({
      where: { productType_productId_costComponent: { productType: 'flight', productId: id, costComponent: COMPONENT_TIKET } },
      create: { productType: 'flight', productId: id, costComponent: COMPONENT_TIKET, vendorId },
      update: { vendorId },
    })

    await refreshFlightScheduleCache(id)

    return NextResponse.json(ok({ vendorId, currency, hargaTiket }))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/flight/schedules/[id]/cost/PUT]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
