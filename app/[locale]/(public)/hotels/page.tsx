import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, BedDouble, Building2, MapPin, SearchX, Star, Tag } from 'lucide-react'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireCatalog } from '@/lib/catalog/availability'
import { getFeaturedCards } from '@/lib/media/urls'
import { sellPrices } from '@/lib/pricing/engine/read'
import { getPageContent, getPageText } from '@/lib/public-content/content'
import { catalogMetadata } from '@/lib/public-content/metadata'
import { DATE_SHORT_MONTH, addDays, calendarDateOf, daysBetween, dbDateOf, formatCalendarDate, isCalendarDate, todayInApp, type CalendarDate } from '@/lib/time'
import { checkoutPath } from '@/lib/checkout/kinds'
import { CHECKOUT_MAX_NIGHTS, CHECKOUT_MAX_PEOPLE, CHECKOUT_MAX_ROOMS } from '@/lib/validators/checkout'
import { formatDistance, formatRupiah } from '@/lib/utils'
import { ProductImage } from '@/components/shared/ProductImage'
import { PageHero, type HeroFact } from '@/components/shared/public/PageHero'
import { PageCta } from '@/components/shared/public/PageCta'
import { CatalogSection } from '@/components/shared/public/CatalogSection'
import { PriceTag } from '@/components/shared/public/PriceTag'
import { HotelSearch, type HotelSearchValue } from './HotelSearch'

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return catalogMetadata((await params).locale, 'hotels')
}

const CITIES = ['makkah', 'madinah'] as const
/** Batas jadwal kamar yang dibaca per pencarian (halaman publik tanpa login — tetap dibatasi). */
const MAX_RESULTS = 200
/** Sisa kamar ditampilkan hanya bila tinggal sedikit (§9 R4). */
const FEW_ROOMS = 5
/** Jumlah periode terdekat yang ditawarkan bila pencarian kosong (§9 R5). */
const NEAREST = 3

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '')
const countParam = (v: string, max: number) => { const n = Number(v); return /^[1-9]\d{0,2}$/.test(v) && n <= max ? n : 1 }

// Katalog Hotel — pola katalog §6.7. Hero varian `search` (docs/arsitektur-frontend-publik.md §9 H3): kota / check-in / check-out / kamar / tamu →
// hotel yang punya tipe kamar dengan SATU periode harga mencakup seluruh malam (aturan mesin pesan, lib/booking/hotelPick.ts) dan kamar cukup,
// harga total = harga kamar per malam × malam × kamar (K-H2); Pilih membuka checkout hotel SUDAH TERISI (lib/checkout/prefill.ts).
// Tanpa tanggal: kartu katalog (harga termurah periode yang mencakup HARI INI, docs/arsitektur-hotel.md §11.2), boleh disaring kota.
// Hotel = master data kecil → dimuat semua, fakta hero tetap seluruh katalog.
export default async function HotelsPage({ params, searchParams }: Props) {
  const { locale } = await params
  await requireCatalog('hotels')
  const query = await searchParams
  const todayCal = todayInApp()
  const today = dbDateOf(todayCal)

  const [rows, content, t] = await Promise.all([
    prisma.hotel.findMany({
      where: { isActive: true },
      select: {
        id: true, name: true, city: true, stars: true, distanceToHaramM: true,
        pricePeriods: {
          where: { isActive: true, periodStart: { lte: today }, periodEnd: { gte: today } },
          select: { schedules: { where: { isActive: true }, select: { id: true } } },
        },
      },
      orderBy: [{ stars: 'desc' }, { distanceToHaramM: 'asc' }, { id: 'asc' }],
    }),
    getPageContent(locale, 'hotels'),
    getPageText(locale, 'hotels'),
  ])
  const scheduleIds = rows.flatMap(h => h.pricePeriods.flatMap(p => p.schedules.map(s => s.id)))
  const [prices, covers] = await Promise.all([sellPrices('hotel', scheduleIds), getFeaturedCards('hotel', rows.map(h => h.id))])
  const hotels = rows.map(h => {
    const priced = h.pricePeriods.flatMap(p => p.schedules).map(s => prices.get(s.id) ?? 0).filter(v => v > 0)
    return { ...h, roomTypes: priced.length, minPrice: priced.length > 0 ? Math.min(...priced) : 0 }
  })

  const priced = hotels.map(h => h.minPrice).filter(v => v > 0)
  const distances = hotels.map(h => h.distanceToHaramM).filter((d): d is number => d !== null && d >= 0)
  const facts: HeroFact[] = []
  if (hotels.length > 0) {
    facts.push({ icon: Building2, label: t('facts.count', { count: hotels.length }) })
    if (priced.length > 0) facts.push({ icon: Tag, label: t('facts.priceFrom', { price: formatRupiah(Math.min(...priced)) }) })
    if (distances.length > 0) facts.push({ icon: MapPin, label: t('facts.nearest', { distance: formatDistance(Math.min(...distances)) }) })
  }
  const cityLabel = (c: string) => ((CITIES as readonly string[]).includes(c) ? t(`card.cities.${c}`) : c)
  const base = `/${locale}/hotels`
  const fmt = (d: CalendarDate) => formatCalendarDate(d, DATE_SHORT_MONTH, locale)

  // Parameter cari = DAFTAR PUTIH: kota hanya dari hotel aktif, tanggal YYYY-MM-DD (check-in ≥ hari ini, check-out sesudahnya, ≤ batas malam checkout),
  // kamar/tamu 1..batas checkout. Nilai asing diabaikan (bukan 500).
  const cityValues = [...new Set(hotels.map(h => h.city))].sort((a, b) => cityLabel(a).localeCompare(cityLabel(b)))
  const city = cityValues.includes(one(query.city)) ? one(query.city) : ''
  const rawIn = one(query.checkIn)
  const rawOut = one(query.checkOut)
  const validStay = isCalendarDate(rawIn) && isCalendarDate(rawOut) && rawIn >= todayCal && rawOut > rawIn && daysBetween(rawIn, rawOut) <= CHECKOUT_MAX_NIGHTS
  const checkIn = validStay ? rawIn as CalendarDate : ''
  const checkOut = validStay ? rawOut as CalendarDate : ''
  const rooms = countParam(one(query.rooms), CHECKOUT_MAX_ROOMS)
  const guests = countParam(one(query.guests), CHECKOUT_MAX_PEOPLE)
  const initial: HotelSearchValue = { city, checkIn, checkOut, rooms, guests }

  const search = hotels.length > 0 ? (
    <HotelSearch locale={locale} cities={cityValues.map(c => ({ value: c, label: cityLabel(c) }))} initial={initial} today={todayCal}
      maxRooms={CHECKOUT_MAX_ROOMS} maxGuests={CHECKOUT_MAX_PEOPLE} maxNights={CHECKOUT_MAX_NIGHTS}
      labels={{
        city: t('search.city'), anyCity: t('search.anyCity'), checkIn: t('search.checkIn'), checkOut: t('search.checkOut'), rooms: t('search.rooms'),
        guests: t('search.guests'), submit: t('search.submit'), needDates: t('search.needDates'), checkInPast: t('search.checkInPast'),
        checkOutAfter: t('search.checkOutAfter'), tooLong: t('search.tooLong', { max: CHECKOUT_MAX_NIGHTS }),
      }} />
  ) : undefined

  const stars = (hotel: { stars: number | null }) => !!hotel.stars && (
    <p className="flex items-center gap-0.5" aria-label={t('card.stars', { count: hotel.stars })}>
      {Array.from({ length: hotel.stars }, (_, i) => <Star key={i} className="h-3.5 w-3.5 fill-brand-gold text-brand-gold" aria-hidden />)}
    </p>
  )
  const distance = (hotel: { distanceToHaramM: number | null }) => hotel.distanceToHaramM !== null && (
    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <MapPin className="h-4 w-4 text-brand" aria-hidden />
      {t('card.distance', { distance: formatDistance(hotel.distanceToHaramM) })}
    </p>
  )

  let body: React.ReactNode
  if (checkIn && checkOut) {
    const nights = daysBetween(checkIn, checkOut)
    const hotelWhere: Prisma.HotelWhereInput = { isActive: true, ...(city ? { city } : {}) }
    const scheduleSelect = {
      id: true, totalQuota: true, pendingQuota: true, bookedQuota: true, roomTypeId: true,
      roomType: { select: { name: true, defaultCapacity: true } }, period: { select: { hotelId: true, periodStart: true, periodEnd: true } },
    } satisfies Prisma.HotelRoomScheduleSelect
    // Seluruh malam dalam SATU periode: check-in ≥ awal periode, check-out ≤ akhir periode (sama dengan mesin pesan).
    const fit = await prisma.hotelRoomSchedule.findMany({
      where: { isActive: true, period: { isActive: true, periodStart: { lte: dbDateOf(checkIn) }, periodEnd: { gte: dbDateOf(checkOut) }, hotel: hotelWhere } },
      select: scheduleSelect, orderBy: { id: 'asc' }, take: MAX_RESULTS,
    })
    const fitPrices = await sellPrices('hotel', fit.map(s => s.id))
    type Offer = { scheduleId: string; roomTypeId: string; room: string; capacity: number; price: number; roomsLeft: number }
    const offersByHotel = new Map<string, Offer[]>()
    for (const s of fit) {
      const price = fitPrices.get(s.id) ?? 0
      const roomsLeft = s.totalQuota - s.pendingQuota - s.bookedQuota
      if (price <= 0 || roomsLeft < rooms) continue // belum berharga / kamar kurang tak ditawarkan
      const list = offersByHotel.get(s.period.hotelId) ?? []
      const same = list.find(o => o.roomTypeId === s.roomTypeId)
      const offer = { scheduleId: s.id, roomTypeId: s.roomTypeId, room: s.roomType.name, capacity: s.roomType.defaultCapacity, price, roomsLeft }
      if (!same) list.push(offer)
      else if (price < same.price) list.splice(list.indexOf(same), 1, offer) // dua periode yang sama-sama cocok: tampilkan yang termurah (checkout memilih periode pertama yang cocok)
      offersByHotel.set(s.period.hotelId, list)
    }
    const found = hotels
      .filter(h => offersByHotel.has(h.id))
      .map(h => ({ hotel: h, offers: offersByHotel.get(h.id)!.sort((a, b) => a.price - b.price || a.capacity - b.capacity) }))
      .sort((a, b) => a.offers[0]!.price - b.offers[0]!.price || a.hotel.name.localeCompare(b.hotel.name))

    // Kosong → periode harga terdekat yang belum lewat (kota yang sama), tautan cari ulang dengan jumlah malam yang sama bila muat.
    let nearest: Array<{ from: CalendarDate; to: CalendarDate }> = []
    if (found.length === 0) {
      const later = await prisma.hotelRoomSchedule.findMany({
        where: { isActive: true, period: { isActive: true, periodEnd: { gt: today }, hotel: hotelWhere } },
        select: { id: true, period: { select: { periodStart: true, periodEnd: true } } },
        orderBy: [{ period: { periodStart: 'asc' } }, { id: 'asc' }], take: MAX_RESULTS,
      })
      const laterPrices = await sellPrices('hotel', later.map(s => s.id))
      const seen = new Set<string>()
      for (const s of later) {
        if ((laterPrices.get(s.id) ?? 0) <= 0) continue
        const from = calendarDateOf(s.period.periodStart) < todayCal ? todayCal : calendarDateOf(s.period.periodStart)
        const to = calendarDateOf(s.period.periodEnd)
        if (to <= from || seen.has(`${from}|${to}`)) continue
        seen.add(`${from}|${to}`)
        nearest.push({ from, to })
        if (nearest.length >= NEAREST) break
      }
    }
    const searchHref = (p: { from: CalendarDate; to: CalendarDate }) => {
      const out = addDays(p.from, nights) <= p.to ? addDays(p.from, nights) : p.to
      return `${base}?${new URLSearchParams({ ...(city ? { city } : {}), checkIn: p.from, checkOut: out, rooms: String(rooms), guests: String(guests) }).toString()}#catalog`
    }

    body = (
      <CatalogSection
        title={t('results.title', { checkIn: fmt(checkIn), checkOut: fmt(checkOut), nights })}
        description={t('results.summary', { city: city ? cityLabel(city) : t('search.anyCity'), rooms, guests })}
        empty={{ icon: SearchX, text: t('results.empty') }}
        isEmpty={false}
      >
        {found.length === 0 ? (
          <div className="space-y-5 rounded-2xl border border-dashed p-8 text-center">
            <SearchX className="mx-auto h-10 w-10 text-muted-foreground opacity-40" aria-hidden />
            <p className="text-muted-foreground">{t('results.empty')}</p>
            {nearest.length > 0 && (
              <div className="mx-auto max-w-xl space-y-2 text-left">
                <p className="text-sm font-semibold text-brand-dark">{t('results.nearest')}</p>
                <ul className="space-y-2">
                  {nearest.map(p => (
                    <li key={`${p.from}|${p.to}`}>
                      <Link href={searchHref(p)} className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-sm transition-colors hover:border-brand">
                        <span className="text-muted-foreground">{t('results.period', { from: fmt(p.from), to: fmt(p.to) })}</span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <ul className="space-y-4">
            {found.map(({ hotel, offers }) => {
              const cover = covers.get(hotel.id)
              return (
                <li key={hotel.id} className="grid overflow-hidden rounded-2xl border bg-card md:grid-cols-[16rem_minmax(0,1fr)]">
                  <Link href={`/${locale}/hotels/${hotel.id}`} className="block" aria-label={hotel.name}>
                    <ProductImage src={cover?.src} alt={cover?.alt} fallbackAlt={hotel.name} type="hotel" />
                  </Link>
                  <div className="space-y-4 p-5">
                    <div className="space-y-2">
                      <span className="catalog-chip">{cityLabel(hotel.city)}</span>
                      <h3 className="text-lg font-semibold leading-snug text-brand-dark">
                        <Link href={`/${locale}/hotels/${hotel.id}`} className="hover:underline">{hotel.name}</Link>
                      </h3>
                      {stars(hotel)}
                      {distance(hotel)}
                    </div>
                    <ul className="divide-y rounded-xl border">
                      {offers.map(o => {
                        const total = o.price * nights * rooms
                        const href = checkoutPath(locale, 'hotel', hotel.id, { room: o.roomTypeId, checkIn, checkOut, rooms, guests })
                        return (
                          <li key={o.roomTypeId} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                            <div className="min-w-0 space-y-1">
                              <p className="flex items-center gap-2 font-semibold text-brand-dark"><BedDouble className="h-4 w-4 shrink-0 text-brand" aria-hidden /> {o.room}</p>
                              <p className="text-xs text-muted-foreground">{t('results.capacity', { count: o.capacity })} · {t('results.perNight', { price: formatRupiah(o.price) })}</p>
                              {o.roomsLeft <= FEW_ROOMS && <p className="text-xs font-semibold text-destructive">{t('results.roomsLeft', { count: o.roomsLeft })}</p>}
                              {rooms * o.capacity < guests && <p className="text-xs text-muted-foreground">{t('results.shortOfBeds', { beds: rooms * o.capacity, guests })}</p>}
                            </div>
                            <div className="space-y-1.5 sm:text-right">
                              <p className="text-xl font-bold tabular-nums text-brand">{formatRupiah(total)}</p>
                              <p className="text-xs text-muted-foreground">{t('results.totalFor', { nights, rooms })}</p>
                              <Link href={href} className="btn-brand-solid w-full sm:w-auto">{t('results.choose')} <ArrowRight className="h-4 w-4" aria-hidden /></Link>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CatalogSection>
    )
  } else {
    const shown = hotels.filter(h => !city || h.city === city)
    body = (
      <CatalogSection
        title={t('list.title')}
        description={t('list.description')}
        empty={{ icon: Building2, text: hotels.length === 0 ? t('list.empty') : t('list.emptyFiltered') }}
        isEmpty={shown.length === 0}
      >
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {shown.map(hotel => {
            const cover = covers.get(hotel.id)
            return (
              <Link key={hotel.id} href={`/${locale}/hotels/${hotel.id}`} className="catalog-card group">
                <ProductImage src={cover?.src} alt={cover?.alt} fallbackAlt={hotel.name} type="hotel" />
                <div className="flex flex-1 flex-col gap-3 p-5">
                  <div className="space-y-2">
                    <span className="catalog-chip">{cityLabel(hotel.city)}</span>
                    <h3 className="text-lg font-semibold leading-snug text-brand-dark">{hotel.name}</h3>
                    {stars(hotel)}
                  </div>
                  {distance(hotel)}
                  <div className="mt-auto space-y-2 border-t pt-4">
                    <PriceTag price={hotel.minPrice} label={t('card.priceFrom')} unit={t('card.perNight')} size="md" />
                    {hotel.roomTypes > 0 && <p className="text-xs text-muted-foreground">{t('card.roomTypes', { count: hotel.roomTypes })}</p>}
                    <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand group-hover:underline">
                      {t('card.details')} <ArrowRight className="h-4 w-4" aria-hidden />
                    </p>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </CatalogSection>
    )
  }

  return (
    <div className="space-y-14">
      <PageHero locale={locale} content={content.hero} facts={facts} variant="search" search={search} />
      {body}
      <PageCta locale={locale} content={content.cta} />
    </div>
  )
}
