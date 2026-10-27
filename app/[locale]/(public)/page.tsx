import Link from 'next/link'
import Image from 'next/image'
import { prisma } from '@/lib/db'
import { getFeaturedCardUrls } from '@/lib/media/urls'
import { Building2, Bus, UserRound, UtensilsCrossed, MapPin, ArrowRight, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatRupiah, formatDistance } from '@/lib/utils'
import { plainText } from '@/lib/rich-text/doc'
import { getMuthowifServicePrice, sellPrices } from '@/lib/pricing/engine/read'

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params

  const [hotelCount, muthowifCount, tourCount] = await Promise.all([
    prisma.hotel.count({ where: { isActive: true } }),
    prisma.muthowif.count({ where: { isActive: true } }),
    prisma.tourPackage.count({ where: { isActive: true } }),
  ])

  const today = new Date()
  const featuredHotelsRaw = await prisma.hotel.findMany({
    where: { isActive: true },
    include: {
      pricePeriods: {
        where: { isActive: true, periodStart: { lte: today }, periodEnd: { gte: today } },
        include: { schedules: { where: { isActive: true } } },
      },
    },
    orderBy: [{ stars: 'desc' }, { distanceToHaramM: 'asc' }],
    take: 3,
  })
  // Jadwal termurah per hotel — harga dari titik harga (docs/arsitektur-harga-terpadu.md §15).
  const featuredPrices = await sellPrices('hotel', featuredHotelsRaw.flatMap(h => h.pricePeriods.flatMap(p => p.schedules.map(s => s.id))))
  const featuredHotels = featuredHotelsRaw.map(h => ({
    ...h,
    schedules: h.pricePeriods.flatMap(p => p.schedules).map(s => ({ ...s, price: featuredPrices.get(s.id) ?? 0 })).sort((a, b) => a.price - b.price).slice(0, 1),
  }))

  const featuredMuthowifRaw = await prisma.muthowif.findMany({
    where: { isActive: true }, orderBy: { rating: 'desc' }, take: 3,
  })
  const muthowifPhotos = await getFeaturedCardUrls('muthowif', featuredMuthowifRaw.map(m => m.id))
  const featuredMuthowif = featuredMuthowifRaw.map(m => ({ ...m, photoUrl: muthowifPhotos.get(m.id) ?? null }))
  const muthowifServicePrice = await getMuthowifServicePrice()

  const services = [
    { icon: Building2, label: 'Hotel', count: `${hotelCount} hotel pilihan`, href: `/${locale}/hotels`, color: 'text-blue-600 bg-blue-50' },
    { icon: Bus, label: 'Transportasi', count: 'Bus, Hiace, Staria', href: `/${locale}/transport`, color: 'text-green-600 bg-green-50' },
    { icon: UserRound, label: 'Muthowif', count: `${muthowifCount} pembimbing`, href: `/${locale}/muthowif`, color: 'text-purple-600 bg-purple-50' },
    { icon: UtensilsCrossed, label: 'Katering', count: 'Full & Half Board', href: `/${locale}/catering`, color: 'text-orange-600 bg-orange-50' },
    { icon: MapPin, label: 'Ziarah', count: `${tourCount} paket tur`, href: `/${locale}/tours`, color: 'text-red-600 bg-red-50' },
  ]

  return (
    <div className="space-y-16">
      {/* Hero */}
      <section className="rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-background p-8 md:p-16 text-center space-y-6">
        <Badge variant="secondary" className="text-xs">Platform Umrah Terpadu</Badge>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
          Rencanakan Umrah Anda<br />
          <span className="text-primary">dengan Mudah & Terpercaya</span>
        </h1>
        <p className="text-muted-foreground max-w-xl mx-auto text-lg">
          Hotel, transportasi, muthowif, katering, dan ziarah — semua dalam satu platform untuk jamaah Indonesia.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button asChild size="lg">
            <Link href={`/${locale}/hotels`}>Mulai Rencanakan <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href={`/${locale}/register`}>Buat Akun Gratis</Link>
          </Button>
        </div>
      </section>

      {/* Services grid */}
      <section className="space-y-6">
        <h2 className="text-2xl font-bold">Layanan Kami</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {services.map(({ icon: Icon, label, count, href, color }) => (
            <Link key={href} href={href}
              className="group rounded-xl border p-4 space-y-3 hover:border-primary hover:shadow-sm transition-all">
              <div className={`inline-flex p-2.5 rounded-lg ${color}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-sm">{label}</p>
                <p className="text-xs text-muted-foreground">{count}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Featured Hotels */}
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Hotel Pilihan</h2>
          <Link href={`/${locale}/hotels`} className="text-sm text-primary hover:underline flex items-center gap-1">
            Lihat semua <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {featuredHotels.map((hotel) => (
            <Link key={hotel.id} href={`/${locale}/hotels/${hotel.id}`}
              className="group rounded-xl border p-5 space-y-3 hover:border-primary hover:shadow-sm transition-all">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold leading-snug">{hotel.name}</p>
                  <p className="text-xs text-muted-foreground capitalize mt-0.5">{hotel.city}</p>
                </div>
                <Badge variant={hotel.city === "makkah" ? "default" : "secondary"} className="shrink-0 capitalize">
                  {hotel.city}
                </Badge>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  {Array.from({ length: hotel.stars ?? 0 }).map((_, i) => (
                    <Star key={i} className="h-3 w-3 fill-amber-400 text-amber-400" />
                  ))}
                </span>
                <span>{formatDistance(hotel.distanceToHaramM ?? 0)} dari Haram</span>
              </div>
              {hotel.schedules[0] && (
                <p className="text-sm font-semibold text-primary">
                  Mulai {formatRupiah(Number(hotel.schedules[0].price))}<span className="text-xs font-normal text-muted-foreground">/malam</span>
                </p>
              )}
            </Link>
          ))}
        </div>
      </section>

      {/* Featured Muthowif */}
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Muthowif Terpercaya</h2>
            {muthowifServicePrice && (
              <p className="text-sm text-muted-foreground mt-0.5">
                Harga layanan mulai {formatRupiah(muthowifServicePrice.price)}/hari
              </p>
            )}
          </div>
          <Link href={`/${locale}/muthowif`} className="text-sm text-primary hover:underline flex items-center gap-1">
            Lihat semua <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {featuredMuthowif.map((m) => (
            <div key={m.id} className="rounded-xl border p-5 space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 overflow-hidden shrink-0 relative grid place-items-center">
                  {m.photoUrl ? (
                    <Image src={m.photoUrl} alt={m.name} fill className="object-cover" unoptimized />
                  ) : (
                    <UserRound className="h-5 w-5 text-primary" />
                  )}
                </div>
                <div>
                  <p className="font-semibold text-sm">{m.name}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    <span className="text-xs text-muted-foreground">{Number(m.rating).toFixed(1)}</span>
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">{plainText(m.bio)}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
