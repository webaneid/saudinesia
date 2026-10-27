import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { cateringOptionCreateSchema } from '@/lib/validators/adminUpdates'
import { emptyToNull } from '@/lib/validators/richText'
import { setManualSell } from '@/lib/pricing/engine'
import { cateringSeasonPrices } from '@/lib/pricing/engine/read'
import { CATERING_SEASONS, cateringVariantKey } from '@/lib/pricing/engine/owners/manualOnly'

function authError(e: unknown): NextResponse | null {
  return e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')
    ? NextResponse.json(err('Forbidden'), { status: 403 })
    : null
}

export async function GET() {
  try {
    await requireManager()
    const rows = await prisma.cateringOption.findMany()
    const prices = await cateringSeasonPrices(rows.map(r => r.id))
    return NextResponse.json(ok(rows.map(r => ({ ...r, pricePerPersonRegular: prices.get(r.id)?.regular ?? 0, pricePerPersonRamadan: prices.get(r.id)?.ramadan ?? 0, pricePerPersonHajj: prices.get(r.id)?.hajj ?? 0 }))))
  } catch (e) {
    const a = authError(e); if (a) return a
    console.error('[admin/products/catering/GET]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireManager()
    const parsed = cateringOptionCreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const c = await prisma.cateringOption.create({
      data: { ...parsed.data, description: emptyToNull(parsed.data.description) },
    })
    // Harga awal dari formulir → titik harga (harga manual, tercatat atas nama pembuat). Musim berharga 0 = belum berharga (tak ada titik).
    const initial = { regular: parsed.data.pricePerPersonRegular, ramadan: parsed.data.pricePerPersonRamadan, hajj: parsed.data.pricePerPersonHajj }
    for (const season of CATERING_SEASONS) {
      if (initial[season] > 0) await setManualSell({ ownerType: 'catering', ownerId: c.id, variantKey: cateringVariantKey(season), sellIdr: initial[season], note: 'Harga awal saat paket dibuat', byUserId: session.userId })
    }
    return NextResponse.json(ok(c), { status: 201 })
  } catch (e) {
    const a = authError(e); if (a) return a
    console.error('[admin/products/catering/POST]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
