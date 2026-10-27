import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { refreshAllPricingCaches } from '@/lib/pricing/refreshAll'
import { DEFAULT_MARGIN_PERCENT, DEFAULT_ROUNDING_INCREMENT, GLOBAL_RULE_KEY } from '@/lib/pricing/pricingHelpers'
import { z } from 'zod'

const updateSchema = z.object({
  minMarginPercent: z.coerce.number().min(0),
  roundingIncrement: z.coerce.number().int().positive(),
})

// Satu baris global dijamin DB: kunci `productType = 'global'` (non-NULL, `@@unique`) — dulu NULL, dan Postgres mengizinkan banyak NULL sehingga dua
// permintaan paralel membuat dua baris global (kejadian nyata, docs/arsitektur-harga-terpadu.md §1.2-7). `upsert` atas kunci unik itu atomik.
function getOrCreateGlobalRule() {
  return prisma.pricingRule.upsert({
    where: { productType: GLOBAL_RULE_KEY },
    update: {},
    create: { productType: GLOBAL_RULE_KEY, minMarginPercent: DEFAULT_MARGIN_PERCENT, roundingIncrement: DEFAULT_ROUNDING_INCREMENT },
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
    const parsed = updateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const rule = await getOrCreateGlobalRule()
    const updated = await prisma.pricingRule.update({
      where: { id: rule.id },
      data: parsed.data,
    })
    // Margin/pembulatan global berubah → SEMUA cache harga jual dihitung ulang (bukan cuma Visa; ini fallback semua tipe produk).
    // Latar belakang: tidak menahan respons; langkah yang gagal dicatat di log.
    void refreshAllPricingCaches()
    return NextResponse.json(ok(updated))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/system/settings/pricing-rule/PUT]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
