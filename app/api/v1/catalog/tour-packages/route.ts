import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getFeaturedCardUrls, getFeaturedCards } from '@/lib/media/urls'
import { ok, err } from '@/lib/validators'
import { z } from 'zod'

const querySchema = z.object({
  city: z.string().optional(),
})

// Menggantikan catalog/tours (HeritageTour) — sekarang paket ziarah terintegrasi TransportTrip
// (docs/arsitektur-ziarah.md §8). Harga "mulai dari" dari cache TourPackage.price.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const parsed = querySchema.safeParse(Object.fromEntries(searchParams))
    if (!parsed.success) return NextResponse.json(err('Parameter tidak valid'), { status: 400 })

    const packages = await prisma.tourPackage.findMany({
      where: { isActive: true },
      include: {
        transportTrip: { select: { origin: true, destination: true } },
        sites: {
          where: parsed.data.city ? { tourismSite: { city: parsed.data.city } } : undefined,
          include: { tourismSite: true },
          orderBy: { order: 'asc' },
        },
      },
      orderBy: { price: 'asc' },
    })

    const covers = await getFeaturedCards('tour_package', packages.map(p => p.id))
    const sitePhotos = await getFeaturedCardUrls('tourism_site', [...new Set(packages.flatMap(p => p.sites.map(s => s.tourismSite.id)))])
    const data = packages.map((p) => ({
      id: p.id, name: p.name, description: p.description,
      coverUrl: covers.get(p.id)?.src ?? null, coverAlt: covers.get(p.id)?.alt ?? null,
      // transportTripId/origin/destination null kalau mode BUKAN user_choice (docs/arsitektur-ziarah.md §12) —
      // mode included tidak butuh tripId ditampilkan (kendaraan sudah baku, tidak ada pilihan).
      transportMode: p.transportMode,
      transportTripId: p.transportMode === 'user_choice' ? p.transportTripId : null,
      origin: p.transportMode === 'user_choice' ? (p.transportTrip?.origin ?? null) : null,
      destination: p.transportMode === 'user_choice' ? (p.transportTrip?.destination ?? null) : null,
      hotelMode: p.hotelMode,
      // priceFrom = harga jual paket DASAR (§12.4) — kalau ada opsi user_choice, front-end wajib
      // tampilkan caption "+ kendaraan/hotel sesuai pilihan", bukan angka tunggal yang membingungkan.
      priceFrom: Number(p.price),
      hasTransportChoice: p.transportMode === 'user_choice',
      hasHotelChoice: p.hotelMode === 'user_choice',
      sites: p.sites.map((s) => ({
        id: s.tourismSite.id, name: s.tourismSite.name, city: s.tourismSite.city,
        description: s.tourismSite.description, gmapsUrl: s.tourismSite.gmapsUrl,
        photoUrl: sitePhotos.get(s.tourismSite.id) ?? null,
      })),
    }))

    return NextResponse.json(ok(data, { total: data.length }))
  } catch (error) {
    console.error('[catalog/tour-packages]', error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
