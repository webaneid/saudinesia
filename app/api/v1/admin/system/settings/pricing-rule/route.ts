import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireMarginRuleEdit } from '@/lib/pricing/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { ok, err } from '@/lib/validators'
import { refreshAllPricingCaches } from '@/lib/pricing/refreshAll'
import { DEFAULT_MARGIN_PERCENT, DEFAULT_ROUNDING_INCREMENT, GLOBAL_RULE_KEY } from '@/lib/pricing/pricingHelpers'
import { z } from 'zod'

// Batas atas (SEC-72): tanpa batas, margin > 999,99 melanggar Decimal(5,2) (500, bukan 400) dan pembulatan raksasa merusak semua katalog. `.strict()` menolak kolom liar.
const MAX_MARGIN_PERCENT = 300
const MAX_ROUNDING_INCREMENT = 10_000_000
const updateSchema = z.object({
  defaultMarginPercent: z.coerce.number().min(0, 'Margin tidak boleh negatif').max(MAX_MARGIN_PERCENT, `Margin maksimal ${MAX_MARGIN_PERCENT}%`),
  roundingIncrement: z.coerce.number().int().positive('Pembulatan harus lebih dari 0').max(MAX_ROUNDING_INCREMENT, `Pembulatan maksimal Rp${MAX_ROUNDING_INCREMENT.toLocaleString('id-ID')}`),
  warnBelowPercent: z.coerce.number().min(0, 'Ambang tidak boleh negatif').max(100, 'Ambang maksimal 100%').optional(),
}).strict()

// Satu baris global dijamin DB: kunci `productType = 'global'` (non-NULL, `@@unique`) — dulu NULL, dan Postgres mengizinkan banyak NULL sehingga dua
// permintaan paralel membuat dua baris global (kejadian nyata, docs/arsitektur-harga-terpadu.md §1.2-7). `upsert` atas kunci unik itu atomik.
function getOrCreateGlobalRule() {
  return prisma.pricingRule.upsert({
    where: { productType: GLOBAL_RULE_KEY },
    update: {},
    create: { productType: GLOBAL_RULE_KEY, defaultMarginPercent: DEFAULT_MARGIN_PERCENT, roundingIncrement: DEFAULT_ROUNDING_INCREMENT },
  })
}

export async function GET() {
  try {
    await requireMarginRuleEdit()
    const rule = await getOrCreateGlobalRule()
    return NextResponse.json(ok(rule))
  } catch (e) {
    return authFailureResponse(e, 'admin/system/settings/pricing-rule/GET')
  }
}

export async function PUT(req: Request) {
  try {
    await requireMarginRuleEdit()
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
    return authFailureResponse(e, 'admin/system/settings/pricing-rule/PUT')
  }
}
