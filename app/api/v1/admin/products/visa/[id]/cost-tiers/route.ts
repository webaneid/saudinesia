import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { refreshVisaProductCache } from '@/lib/pricing/refreshVisaProductCache'
import { z } from 'zod'

// Visa punya persis 2 komponen HPP tetap (dikonfirmasi user 2026-07-18) — lihat docs/arsitektur-harga.md §14.
const COMPONENT_VISA = 'individu'
const COMPONENT_BRN = 'biaya_non_hotel'

type TierWithId = { id: string; minDays: number; maxDays: number; cost: number }
type IndividuTierWithId = TierWithId & { sellPriceOverride?: number | null }

const tierRowSchema = z.object({
  id: z.string().min(1),
  minDays: z.coerce.number().int().min(0),
  maxDays: z.coerce.number().int().min(0),
  hargaVisa: z.coerce.number().positive(),
  hargaBrn: z.coerce.number().positive().nullable().optional(),
  sellPriceOverride: z.coerce.number().positive().nullable().optional(),
})

const putSchema = z.object({
  visa: z.object({ vendorId: z.string().min(1), currency: z.string().min(1) }),
  brn: z.object({ vendorId: z.string().min(1), currency: z.string().min(1) }).nullable(),
  rows: z.array(tierRowSchema).min(1),
})

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireSuperAdmin()
    const { id } = await params

    const costs = await prisma.productCost.findMany({
      where: { productType: 'visa', productId: id, costComponent: { in: [COMPONENT_VISA, COMPONENT_BRN] }, isActive: true },
    })
    const individu = costs.find(c => c.costComponent === COMPONENT_VISA)
    const brnCost = costs.find(c => c.costComponent === COMPONENT_BRN)

    const individuTiers = (individu?.costTiers as unknown as IndividuTierWithId[]) ?? []
    const brnTiers = (brnCost?.costTiers as unknown as TierWithId[]) ?? []
    const brnByRowId = new Map(brnTiers.filter(t => t.id).map(t => [t.id, t]))

    const rows = individuTiers.map(t => ({
      id: t.id,
      minDays: t.minDays,
      maxDays: t.maxDays,
      hargaVisa: t.cost,
      hargaBrn: brnByRowId.get(t.id)?.cost ?? null,
      sellPriceOverride: t.sellPriceOverride ?? null,
    }))

    return NextResponse.json(ok({
      visa: individu ? { vendorId: individu.vendorId, currency: individu.currency } : null,
      brn: brnCost ? { vendorId: brnCost.vendorId, currency: brnCost.currency } : null,
      rows,
    }))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/visa/[id]/cost-tiers/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireSuperAdmin()
    const { id } = await params
    const parsed = putSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const { visa, brn, rows } = parsed.data

    const individuTiers: IndividuTierWithId[] = rows.map(r => ({
      id: r.id, minDays: r.minDays, maxDays: r.maxDays, cost: r.hargaVisa,
      sellPriceOverride: r.sellPriceOverride ?? null,
    }))
    const brnRows = rows.filter(r => r.hargaBrn != null)
    const brnTiers: TierWithId[] = brnRows.map(r => ({ id: r.id, minDays: r.minDays, maxDays: r.maxDays, cost: r.hargaBrn as number }))
    const brnActive = brn !== null && brnTiers.length > 0

    const [existingIndividu, existingBrn] = await Promise.all([
      prisma.productCost.findFirst({ where: { productType: 'visa', productId: id, costComponent: COMPONENT_VISA } }),
      prisma.productCost.findFirst({ where: { productType: 'visa', productId: id, costComponent: COMPONENT_BRN } }),
    ])

    if (existingIndividu) {
      await prisma.productCost.update({
        where: { id: existingIndividu.id },
        data: { vendorId: visa.vendorId, currency: visa.currency, costTiers: individuTiers, isActive: true },
      })
    } else {
      await prisma.productCost.create({
        data: { productType: 'visa', productId: id, costComponent: COMPONENT_VISA, vendorId: visa.vendorId, currency: visa.currency, costTiers: individuTiers },
      })
    }

    if (brnActive) {
      if (existingBrn) {
        await prisma.productCost.update({
          where: { id: existingBrn.id },
          data: { vendorId: brn!.vendorId, currency: brn!.currency, costTiers: brnTiers, isActive: true },
        })
      } else {
        await prisma.productCost.create({
          data: { productType: 'visa', productId: id, costComponent: COMPONENT_BRN, vendorId: brn!.vendorId, currency: brn!.currency, costTiers: brnTiers },
        })
      }
    } else if (existingBrn?.isActive) {
      // BRN dimatikan admin — nonaktifkan (soft), jangan hapus fisik, supaya histori HPP tetap ada untuk audit
      await prisma.productCost.update({ where: { id: existingBrn.id }, data: { isActive: false } })
    }

    await prisma.preferredVendor.upsert({
      where: { productType_productId_costComponent: { productType: 'visa', productId: id, costComponent: COMPONENT_VISA } },
      create: { productType: 'visa', productId: id, costComponent: COMPONENT_VISA, vendorId: visa.vendorId },
      update: { vendorId: visa.vendorId },
    })
    if (brnActive) {
      await prisma.preferredVendor.upsert({
        where: { productType_productId_costComponent: { productType: 'visa', productId: id, costComponent: COMPONENT_BRN } },
        create: { productType: 'visa', productId: id, costComponent: COMPONENT_BRN, vendorId: brn!.vendorId },
        update: { vendorId: brn!.vendorId },
      })
    } else {
      await prisma.preferredVendor.deleteMany({ where: { productType: 'visa', productId: id, costComponent: COMPONENT_BRN } })
    }

    await refreshVisaProductCache(id)

    return NextResponse.json(ok({
      visa,
      brn: brnActive ? brn : null,
      rows: rows.map(r => ({
        id: r.id, minDays: r.minDays, maxDays: r.maxDays, hargaVisa: r.hargaVisa,
        hargaBrn: r.hargaBrn ?? null, sellPriceOverride: r.sellPriceOverride ?? null,
      })),
    }))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/visa/[id]/cost-tiers/PUT]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
