import { getFeaturedCards } from '@/lib/media/urls'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ok, err } from '@/lib/validators'

export async function GET() {
  try {
    const products = await prisma.visaProduct.findMany({
      where: { isActive: true },
      orderBy: [{ country: 'asc' }, { visaType: 'asc' }],
    })
    const covers = await getFeaturedCards('visa', products.map(p => p.id))
    return NextResponse.json(ok(
      products.map(p => {
        // priceIsRange: true kalau ada >=2 harga BERBEDA di antara tier durasi — dipakai
        // katalog publik untuk label "Mulai dari". durationFeeRules sendiri TIDAK di-expose
        // ke publik (docs/arsitektur-harga.md §17.5) — cukup boolean turunannya saja.
        const { durationFeeRules, ...rest } = p
        const fees = (durationFeeRules as unknown as { fee: number }[]).map(r => r.fee)
        const priceIsRange = new Set(fees).size >= 2
        return { ...rest, price: Number(p.price), priceIsRange, coverUrl: covers.get(p.id)?.src ?? null, coverAlt: covers.get(p.id)?.alt ?? null }
      }),
      { total: products.length }
    ))
  } catch (e) {
    console.error('[catalog/visa]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
