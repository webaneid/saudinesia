import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'

// Harga sekarang cache dari HPP (docs/arsitektur-muthowif.md §10) — tidak lagi diisi manual di
// sini, cuma dibaca. Edit harga lewat .../service-price/cost.
async function getOrCreateServicePrice() {
  const existing = await prisma.muthowifServicePrice.findFirst()
  if (existing) return existing
  return prisma.muthowifServicePrice.create({ data: { price: 0 } })
}

export async function GET() {
  try {
    await requireSuperAdmin()
    const price = await getOrCreateServicePrice()
    return NextResponse.json(ok(price))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/muthowif/service-price/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
