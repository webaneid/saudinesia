import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ok, err } from '@/lib/validators'
import { clearManualSellSchema, pricePointQuerySchema, setManualCostSchema, setManualSellSchema } from '@/lib/validators/pricing'
import { requirePricingEdit, requirePricingView } from '@/lib/pricing/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { SUPERADMIN_ROLES } from '@/lib/auth/session'
import { resolveMarginRule } from '@/lib/pricing/pricingHelpers'
import { clearManualSell, getPricePoints, listPriceChanges, PriceInputError, setManualCost, setManualSell } from '@/lib/pricing/engine'
import { PRICE_OWNERS } from '@/lib/pricing/engine'

// Titik harga satu produk untuk PriceCard (docs/arsitektur-harga-terpadu.md §16): modal · jual · untung per varian, aturan margin yang berlaku, riwayat singkat.
// Peran lewat lib/pricing/policy.ts (satu titik). Jamaah/publik tidak pernah sampai sini (I5).

const TAG = 'admin/pricing/points'

export async function GET(req: Request) {
  try {
    const session = await requirePricingView()
    const parsed = pricePointQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) return NextResponse.json(err('Parameter tidak valid'), { status: 400 })
    const { ownerType, ownerId } = parsed.data
    const points = await getPricePoints(ownerType, ownerId)
    // Komponen biaya memakai margin tipe produk INDUKNYA (rekomendasinya dihitung dengan aturan itu) — bukan aturan bernama `cost_component`.
    const marginType = (await PRICE_OWNERS[ownerType].parent?.(ownerId))?.ownerType ?? ownerType
    const [rule, changes, warn, variants] = await Promise.all([
      resolveMarginRule(marginType),
      listPriceChanges(ownerType, ownerId, 10),
      prisma.pricingRule.findUnique({ where: { productType: 'global' }, select: { warnBelowPercent: true } }),
      PRICE_OWNERS[ownerType].variants?.(ownerId) ?? Promise.resolve([]),
    ])
    return NextResponse.json(ok({
      points,
      // Rincian poin Platform Provider hanya untuk superadmin (halaman Platform Provider juga superadmin-only, SEC-281); peran lain melihat margin gabungan.
      rule: { marginPercent: rule.defaultMarginPercent, ...(SUPERADMIN_ROLES.includes(session.role) ? { clientMarginPercent: rule.clientMarginPercent, providerMarkupPercent: rule.providerMarkupPercent } : {}), roundingIncrement: rule.roundingIncrement, warnBelowPercent: warn ? Number(warn.warnBelowPercent) : 0 },
      manualOnly: PRICE_OWNERS[ownerType].manualOnly === true,
      // Varian yang boleh dibuat lewat harga manual (mis. musim katering yang belum diisi) — agar PriceCard dapat menampilkan baris "belum berharga".
      creatable: [...PRICE_OWNERS[ownerType].creatableVariants.map(v => v.key), ...variants.filter(v => v.creatable).map(v => v.key)],
      // Varian dinamis (harga khusus keberangkatan): label tampilan + yang mengikuti harga dasar bila kosong.
      labels: Object.fromEntries(variants.map(v => [v.key, v.label])),
      inherits: variants.filter(v => v.inheritsBase).map(v => v.key),
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
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
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
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
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
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const view = await setManualCost({ ...parsed.data, byUserId: session.userId })
    return NextResponse.json(ok(view))
  } catch (e) {
    if (e instanceof PriceInputError) return NextResponse.json(err(e.message), { status: 400 })
    return authFailureResponse(e, `${TAG}/PATCH`)
  }
}
