import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { refreshAllVisaProductCaches } from '@/lib/pricing/refreshVisaProductCache'
import { z } from 'zod'

const updateSchema = z.object({
  minMarginPercent: z.coerce.number().min(0),
  roundingIncrement: z.coerce.number().int().positive(),
})

// Satu baris global (productType: null) — invarian "hanya satu baris global" ditegakkan
// di sini via upsert-by-known-condition, bukan constraint DB (lihat docs/decisions.md 2026-07-17
// soal @@unique([productType]) tidak mencegah banyak baris NULL di Postgres).
async function getOrCreateGlobalRule() {
  const existing = await prisma.pricingRule.findFirst({ where: { productType: null } })
  if (existing) return existing
  return prisma.pricingRule.create({
    data: { productType: null, minMarginPercent: 20, roundingIncrement: 50000 },
  })
}

export async function GET() {
  try {
    await requireSuperAdmin()
    const rule = await getOrCreateGlobalRule()
    return NextResponse.json(ok(rule))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/system/settings/pricing-rule/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    await requireSuperAdmin()
    const parsed = updateSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const rule = await getOrCreateGlobalRule()
    const updated = await prisma.pricingRule.update({
      where: { id: rule.id },
      data: parsed.data,
    })
    // Margin/pembulatan global berubah → semua produk visa perlu di-refresh cache-nya
    // (bukan cuma yang di-override, karena ini fallback untuk semua productType).
    void refreshAllVisaProductCaches()
    return NextResponse.json(ok(updated))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/system/settings/pricing-rule/PUT]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
