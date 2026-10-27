import { getFeaturedCards } from '@/lib/media/urls'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ok, err } from '@/lib/validators'

export async function GET() {
  try {
    const packages = await prisma.package.findMany({
      where: { isActive: true },
      orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
    })
    const covers = await getFeaturedCards('package', packages.map(p => p.id))
    return NextResponse.json(ok(packages.map(p => ({
      ...p,
      coverUrl: covers.get(p.id)?.src ?? null, coverAlt: covers.get(p.id)?.alt ?? null,
      price: Number(p.price),
      // Info tambahan buat catalog publik — beberapa komponen dibayar terpisah saat booking
      // (docs/arsitektur-paket-umroh.md §3), TIDAK termasuk harga "mulai dari" di atas.
      hasAddOns: [p.hotelMakkahMode, p.hotelMadinahMode, p.transportMode, p.muthowifMode, p.visaMode, p.flightMode, p.cateringMode]
        .includes('user_choice'),
    })), { total: packages.length }))
  } catch (e) { console.error('[catalog/packages]', e); return NextResponse.json(err('Internal server error'), { status: 500 }) }
}
