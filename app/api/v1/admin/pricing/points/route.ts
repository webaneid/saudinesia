import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ok, err } from '@/lib/validators'
import { clearManualSellSchema, pricePointQuerySchema, setManualCostSchema, setManualSellSchema } from '@/lib/validators/pricing'
import { requirePricingEdit, requirePricingView } from '@/lib/pricing/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { resolveMarginRule } from '@/lib/pricing/pricingHelpers'
import { clearManualSell, getPricePoints, listPriceChanges, PriceInputError, setManualCost, setManualSell } from '@/lib/pricing/engine'
import { PRICE_OWNERS } from '@/lib/pricing/engine'

// Titik harga satu produk untuk PriceCard (docs/arsitektur-harga-terpadu.md §16): modal · jual · untung per varian, aturan margin yang berlaku, riwayat singkat.
// Peran lewat lib/pricing/policy.ts (satu titik). Jamaah/publik tidak pernah sampai sini (I5).

const TAG = 'admin/pricing/points'

export async function GET(req: Request) {
  try {
    await requirePricingView()
    const parsed = pricePointQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) return NextResponse.json(err('Parameter tidak valid'), { status: 400 })
    const { ownerType, ownerId } = parsed.data
    const points = await getPricePoints(ownerType, ownerId)
    const [rule, changes, warn] = await Promise.all([
      resolveMarginRule(ownerType),
      listPriceChanges(ownerType, ownerId, 10),
      prisma.pricingRule.findUnique({ where: { productType: 'global' }, select: { warnBelowPercent: true } }),
    ])
    return NextResponse.json(ok({
      points,
      rule: { marginPercent: rule.minMarginPercent, roundingIncrement: rule.roundingIncrement, warnBelowPercent: warn ? Number(warn.warnBelowPercent) : 0 },
      manualOnly: PRICE_OWNERS[ownerType].manualOnly === true,
      // Varian yang boleh dibuat lewat harga manual (mis. musim katering yang belum diisi) — agar PriceCard dapat menampilkan baris "belum berharga".
      creatable: PRICE_OWNERS[ownerType].creatableVariants.map(v => v.key),
      changes,
    }))
  } catch (e) {
    return authFailureResponse(e, `${TAG}/GET`)
  }
}

export async function PUT(req: Request) {
  try {
    const session = await requirePricingEdit()
    const parsed = setManualSellSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const view = await setManualSell({ ...parsed.data, byUserId: session.userId })
    return NextResponse.json(ok(view))
  } catch (e) {
    if (e instanceof PriceInputError) return NextResponse.json(err(e.message), { status: 400 })
    return authFailureResponse(e, `${TAG}/PUT`)
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await requirePricingEdit()
    const parsed = clearManualSellSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const view = await clearManualSell({ ...parsed.data, byUserId: session.userId })
    return NextResponse.json(ok(view))
  } catch (e) {
    if (e instanceof PriceInputError) return NextResponse.json(err(e.message), { status: 400 })
    return authFailureResponse(e, `${TAG}/DELETE`)
  }
}

/** Modal untuk pemilik manual-only (katering, layanan hotel). Pemilik berbasis perhitungan ditolak (400): modalnya milik editor biaya (HPP). */
export async function PATCH(req: Request) {
  try {
    const session = await requirePricingEdit()
    const parsed = setManualCostSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const view = await setManualCost({ ...parsed.data, byUserId: session.userId })
    return NextResponse.json(ok(view))
  } catch (e) {
    if (e instanceof PriceInputError) return NextResponse.json(err(e.message), { status: 400 })
    return authFailureResponse(e, `${TAG}/PATCH`)
  }
}
