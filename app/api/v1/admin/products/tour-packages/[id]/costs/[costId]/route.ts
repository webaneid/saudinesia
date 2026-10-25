import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { isRecordNotFound } from '@/lib/admin/errors'
import { refreshTourPackagePriceCache } from '@/lib/pricing/refreshTourPackagePriceCache'
import { z } from 'zod'

const FLAT_TIER = { minDays: 0, maxDays: 9999 }
type CostTier = { minDays: number; maxDays: number; cost: number }

const updateSchema = z.object({
  costComponent: z.string().min(1).optional(),
  vendorId:      z.string().min(1).optional(),
  currency:      z.string().min(1).optional(),
  cost:          z.coerce.number().positive().optional(),
})

type Ctx = { params: Promise<{ id: string; costId: string }> }

export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireSuperAdmin()
    const { id: tourPackageId, costId } = await params
    const parsed = updateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const { cost, ...rest } = parsed.data

    await prisma.productCost.update({
      where: { id: costId },
      data: { ...rest, ...(cost !== undefined ? { costTiers: [{ ...FLAT_TIER, cost }] as CostTier[] } : {}) },
    })

    await refreshTourPackagePriceCache(tourPackageId)

    return NextResponse.json(ok(null))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Komponen biaya tidak ditemukan'), { status: 404 })
    console.error('[admin/products/tour-packages/[id]/costs/[costId]/PUT]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireSuperAdmin()
    const { id: tourPackageId, costId } = await params
    await prisma.productCost.delete({ where: { id: costId } })
    await refreshTourPackagePriceCache(tourPackageId)
    return NextResponse.json(ok(null))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Komponen biaya tidak ditemukan'), { status: 404 })
    console.error('[admin/products/tour-packages/[id]/costs/[costId]/DELETE]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
