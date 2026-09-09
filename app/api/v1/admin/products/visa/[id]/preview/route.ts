import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { computeSellPrice } from '@/lib/pricing/computeSellPrice'
import { prisma } from '@/lib/db'

type Ctx = { params: Promise<{ id: string }> }

// Preview transparan HPP → kurs → margin → harga jual, untuk admin melihat perhitungan
// sebelum/tanpa harus menunggu cache VisaProduct.price di-refresh. Lihat docs/arsitektur-harga.md §5.
export async function GET(req: Request, { params }: Ctx) {
  try {
    await requireSuperAdmin()
    const { id } = await params
    const { searchParams } = new URL(req.url)
    const days = Number(searchParams.get('days') ?? '1')

    const result = await computeSellPrice('visa', id, days)
    if (!result) return NextResponse.json(ok({ hppRupiah: 0, minSellPrice: 0, sellPrice: 0, rates: [] }))

    const rates = await prisma.exchangeRate.findMany({
      where: { id: { in: result.rateUsed } },
      select: { id: true, fromCurrency: true, toCurrency: true, midRate: true, sellRate: true, fetchedAt: true },
    })

    return NextResponse.json(ok({ ...result, rates }))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/visa/[id]/preview/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
