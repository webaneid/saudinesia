import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { refreshMuthowifServicePriceCache } from '@/lib/pricing/refreshMuthowifServicePriceCache'
import { z } from 'zod'

// Muthowif punya persis 1 komponen HPP tetap, tidak day-based — pola identik Flight
// (docs/arsitektur-muthowif.md §10).
const COMPONENT_LAYANAN = 'layanan'
const FLAT_TIER = { minDays: 0, maxDays: 9999 }

type CostTier = { minDays: number; maxDays: number; cost: number }

const putSchema = z.object({
  currency: z.string().min(1),
  hargaLayanan: z.coerce.number().positive(),
})

// Muthowif TIDAK punya vendor pihak ketiga sungguhan — beda dari Visa/Flight/Hotel/Transport.
// Saudinesia menetapkan sendiri "harga pasaran" lalu mark-up, bukan beli dari vendor luar
// (dikonfirmasi user 2026-07-20). `ProductCost.vendorId` tetap wajib diisi (skema generik dipakai
// 4 modul lain, tidak diubah) — jadi dipakai satu vendor tetap "Saudinesia" di baliknya, tapi
// vendor ini TIDAK dipilih admin, cuma ditampilkan read-only di UI.
const SAUDINESIA_VENDOR_NAME = 'Saudinesia'

async function getOrCreateServicePrice() {
  const existing = await prisma.muthowifServicePrice.findFirst()
  if (existing) return existing
  return prisma.muthowifServicePrice.create({ data: { price: 0 } })
}

async function getOrCreateSaudinesiaVendor() {
  const existing = await prisma.vendor.findFirst({ where: { name: SAUDINESIA_VENDOR_NAME, category: 'internal' } })
  if (existing) return existing
  return prisma.vendor.create({
    data: { name: SAUDINESIA_VENDOR_NAME, category: 'internal', country: 'Indonesia' },
  })
}

export async function GET() {
  try {
    await requireSuperAdmin()
    const servicePrice = await getOrCreateServicePrice()

    const cost = await prisma.productCost.findFirst({
      where: { productType: 'muthowif', productId: servicePrice.id, costComponent: COMPONENT_LAYANAN, isActive: true },
    })
    const tiers = (cost?.costTiers as unknown as CostTier[]) ?? []
    const hargaLayanan = tiers[0]?.cost ?? null

    return NextResponse.json(ok({
      vendorName: SAUDINESIA_VENDOR_NAME,
      currency: cost?.currency ?? null,
      hargaLayanan,
    }))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/muthowif/service-price/cost/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    await requireSuperAdmin()
    const servicePrice = await getOrCreateServicePrice()
    const parsed = putSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const { currency, hargaLayanan } = parsed.data
    const vendor = await getOrCreateSaudinesiaVendor()

    const costTiers: CostTier[] = [{ ...FLAT_TIER, cost: hargaLayanan }]

    const existing = await prisma.productCost.findFirst({
      where: { productType: 'muthowif', productId: servicePrice.id, costComponent: COMPONENT_LAYANAN },
    })

    if (existing) {
      await prisma.productCost.update({
        where: { id: existing.id },
        data: { vendorId: vendor.id, currency, costTiers, isActive: true },
      })
    } else {
      await prisma.productCost.create({
        data: { productType: 'muthowif', productId: servicePrice.id, costComponent: COMPONENT_LAYANAN, vendorId: vendor.id, currency, costTiers },
      })
    }

    await prisma.preferredVendor.upsert({
      where: { productType_productId_costComponent: { productType: 'muthowif', productId: servicePrice.id, costComponent: COMPONENT_LAYANAN } },
      create: { productType: 'muthowif', productId: servicePrice.id, costComponent: COMPONENT_LAYANAN, vendorId: vendor.id },
      update: { vendorId: vendor.id },
    })

    await refreshMuthowifServicePriceCache()

    return NextResponse.json(ok({ vendorName: SAUDINESIA_VENDOR_NAME, currency, hargaLayanan }))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/muthowif/service-price/cost/PUT]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
