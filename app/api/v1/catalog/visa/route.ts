import { getFeaturedCards } from '@/lib/media/urls'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ok, err } from '@/lib/validators'
import { visaPriceSummary } from '@/lib/pricing/engine/read'

export async function GET() {
  try {
    const products = await prisma.visaProduct.findMany({
      where: { isActive: true },
      orderBy: [{ country: 'asc' }, { visaType: 'asc' }],
    })
    const covers = await getFeaturedCards('visa', products.map(p => p.id))
    const summary = await visaPriceSummary(products.map(p => p.id))
    return NextResponse.json(ok(
      products.map(p => {
        // priceIsRange: true kalau ada >=2 harga BERBEDA di antara tier durasi — dipakai
        // katalog publik untuk label "Mulai dari". Rincian tier TIDAK di-expose ke publik
        // (docs/arsitektur-harga.md §17.5) — cukup boolean turunannya saja. Harga dari titik harga (Fase 2).
        const rest: Record<string, unknown> = { ...p }
        delete rest.durationFeeRules // rincian tier tidak keluar ke publik; kolom cache lama tak ikut
        const { from, isRange: priceIsRange } = summary.get(p.id) ?? { from: 0, isRange: false }
        return { ...rest, price: from, priceIsRange, coverUrl: covers.get(p.id)?.src ?? null, coverAlt: covers.get(p.id)?.alt ?? null }
      }),
      { total: products.length }
    ))
  } catch (e) {
    console.error('[catalog/visa]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
