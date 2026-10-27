import Link from 'next/link'
import Image from 'next/image'
import { prisma } from '@/lib/db'
import { getFeaturedCardUrls } from '@/lib/media/urls'
import { Building2, Star, MapPin } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatRupiah, formatDistance } from '@/lib/utils'
import { sellPrices } from '@/lib/pricing/engine/read'

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ city?: string; stars?: string }> }

export default async function HotelsPage({ params, searchParams }: Props) {
  const { locale } = await params
  const { city, stars } = await searchParams
  const today = new Date()

  // Harga & ketersediaan di-resolve dari HotelRoomSchedule (lewat HotelPricePeriod) yang periodenya
  // mencakup hari ini — bukan lagi detectSeason() (docs/arsitektur-hotel.md §11.2).
  const hotelsRaw = await prisma.hotel.findMany({
    where: {
      isActive: true,
      ...(city && city !== 'all' ? { city } : {}),
      ...(stars ? { stars: parseInt(stars) } : {}),
    },
    include: {
      pricePeriods: {
        where: { isActive: true, periodStart: { lte: today }, periodEnd: { gte: today } },
        include: { schedules: { where: { isActive: true }, include: { roomType: true } } },
      },
    },
    orderBy: [{ stars: 'desc' }, { distanceToHaramM: 'asc' }],
  })
  // Flatten ke bentuk `schedules` yang sama seperti sebelumnya supaya sisa halaman ini tidak perlu berubah.
  // Harga jual per jadwal kamar dari titik harga (docs/arsitektur-harga-terpadu.md §15); urut termurah dulu.
  const hotelPrices = await sellPrices('hotel', hotelsRaw.flatMap(h => h.pricePeriods.flatMap(p => p.schedules.map(s => s.id))))
  const hotels = hotelsRaw.map(h => ({
    ...h,
    schedules: h.pricePeriods.flatMap(p => p.schedules).map(s => ({ ...s, price: hotelPrices.get(s.id) ?? 0 })).sort((a, b) => a.price - b.price),
  }))

  // Foto sampul — layanan media universal (satu query batch; sampul eksplisit, fallback foto pertama sudah ditangani layanan).
  const covers = await getFeaturedCardUrls('hotel', hotels.map(h => h.id))
  const hotelsWithCovers = hotels.map(h => ({ ...h, coverUrl: covers.get(h.id) ?? null }))

  const filterLink = (p: Record<string, string>) => {
    const qs = new URLSearchParams({ ...(city && { city }), ...(stars && { stars }), ...p })
    return `/${locale}/hotels?${qs.toString()}`
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Hotel Umrah & Haji</h1>
        <p className="text-muted-foreground mt-1">{hotels.length} hotel tersedia</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <span className="text-sm text-muted-foreground self-center">Kota:</span>
        {(['all','makkah','madinah'] as const).map((v) => {
          const l = { all: 'Semua', makkah: 'Makkah', madinah: 'Madinah' }[v]
          const active = (!city || city === 'all') && v === 'all' ? true : city === v
          return (
            <Link key={v} href={filterLink({ city: v })}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${active ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent'}`}>
              {l}
            </Link>
          )
        })}
        <span className="text-sm text-muted-foreground self-center ml-4">Bintang:</span>
        {(['', '5', '4'] as const).map((v) => {
          const l = v === '' ? 'Semua' : v === '5' ? '⭐⭐⭐⭐⭐' : '⭐⭐⭐⭐'
          return (
            <Link key={v} href={filterLink({ stars: v })}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${stars === v || (!stars && !v) ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent'}`}>
              {l}
            </Link>
          )
        })}
      </div>

      {/* Grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {hotelsWithCovers.map((hotel) => {
          const cheapestSchedule = hotel.schedules[0]
          const minPrice = cheapestSchedule ? Number(cheapestSchedule.price) : 0
          return (
            <Link key={hotel.id} href={`/${locale}/hotels/${hotel.id}`}
              className="group rounded-xl border overflow-hidden hover:border-primary hover:shadow-sm transition-all">
              {/* Cover photo */}
              <div className="relative h-44 bg-muted">
                {hotel.coverUrl ? (
                  <Image
                    src={hotel.coverUrl}
                    alt={hotel.name}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                    unoptimized
                  />
                ) : (
                  <div className="h-full flex items-center justify-center">
                    <Building2 className="h-10 w-10 text-muted-foreground/30" />
                  </div>
                )}
                <div className="absolute top-2 right-2">
                  <Badge variant={hotel.city === 'makkah' ? 'default' : 'secondary'} className="capitalize">
                    {hotel.city}
                  </Badge>
                </div>
              </div>

              {/* Info */}
              <div className="p-5 space-y-3">
                <div className="space-y-1">
                  <p className="font-semibold leading-tight">{hotel.name}</p>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: hotel.stars ?? 0 }).map((_, i) => (
                      <Star key={i} className="h-3 w-3 fill-amber-400 text-amber-400" />
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" />
                  <span>{formatDistance(hotel.distanceToHaramM ?? 0)} dari Masjid Al-Haram</span>
                </div>
                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground">Mulai dari</p>
                  <p className="text-lg font-bold text-primary">
                    {formatRupiah(minPrice)}
                    <span className="text-xs font-normal text-muted-foreground">/malam</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{hotel.schedules.length} tipe kamar tersedia</p>
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      {hotels.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Building2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>Tidak ada hotel yang sesuai filter.</p>
        </div>
      )}
    </div>
  )
}
