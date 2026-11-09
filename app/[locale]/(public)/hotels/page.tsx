import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, Building2, MapPin, Star, Tag } from 'lucide-react'
import { prisma } from '@/lib/db'
import { requireCatalog } from '@/lib/catalog/availability'
import { getFeaturedCards } from '@/lib/media/urls'
import { sellPrices } from '@/lib/pricing/engine/read'
import { getPageContent, getPageText } from '@/lib/public-content/content'
import { catalogMetadata } from '@/lib/public-content/metadata'
import { dbDateOf, todayInApp } from '@/lib/time'
import { formatDistance, formatRupiah } from '@/lib/utils'
import { ProductImage } from '@/components/shared/ProductImage'
import { FilterBar } from '@/components/shared/data-table/FilterBar'
import { FilterSelect } from '@/components/shared/data-table/FilterSelect'
import { PageHero, type HeroFact } from '@/components/shared/public/PageHero'
import { PageCta } from '@/components/shared/public/PageCta'
import { CatalogSection } from '@/components/shared/public/CatalogSection'
import { PriceTag } from '@/components/shared/public/PriceTag'

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ city?: string; stars?: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return catalogMetadata((await params).locale, 'hotels')
}

const CITIES = ['makkah', 'madinah'] as const

// Katalog Hotel — pola katalog §6.7. Harga = kamar termurah dari periode yang mencakup HARI INI (zona aplikasi, docs/arsitektur-hotel.md §11.2).
// Filter = FilterSelect (daftar putih nilai; nilai asing diabaikan). Hotel = master data kecil → dimuat semua, difilter di memori, fakta hero tetap seluruh katalog.
export default async function HotelsPage({ params, searchParams }: Props) {
  const { locale } = await params
  await requireCatalog('hotels')
  const query = await searchParams
  const today = dbDateOf(todayInApp())

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

  const starOptions = [...new Set(hotels.map(h => h.stars).filter((s): s is number => !!s && s > 0))].sort((a, b) => b - a)
  const city = (CITIES as readonly string[]).includes(query.city ?? '') ? query.city! : ''
  const stars = starOptions.map(String).includes(query.stars ?? '') ? query.stars! : ''
  const shown = hotels.filter(h => (!city || h.city === city) && (!stars || String(h.stars) === stars))

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

  return (
    <div className="space-y-14">
      <PageHero locale={locale} content={content.hero} facts={facts} />

      <CatalogSection
        title={t('list.title')}
        description={t('list.description')}
        empty={{ icon: Building2, text: hotels.length === 0 ? t('list.empty') : t('list.emptyFiltered') }}
        isEmpty={shown.length === 0}
        toolbar={hotels.length > 0 && (
          <FilterBar active={!!city || !!stars} resetHref={`${base}#catalog`}>
            <FilterSelect
              label={t('filters.city')}
              allLabel={t('filters.all')}
              options={CITIES.map(c => ({ value: c, label: cityLabel(c) }))}
              value={city}
              nav={{ base, param: 'city', query: { stars: stars || undefined } }}
            />
            {starOptions.length > 1 && (
              <FilterSelect
                label={t('filters.stars')}
                allLabel={t('filters.all')}
                options={starOptions.map(s => ({ value: String(s), label: t('card.stars', { count: s }) }))}
                value={stars}
                nav={{ base, param: 'stars', query: { city: city || undefined } }}
              />
            )}
          </FilterBar>
        )}
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
                    {!!hotel.stars && (
                      <p className="flex items-center gap-0.5" aria-label={t('card.stars', { count: hotel.stars })}>
                        {Array.from({ length: hotel.stars }, (_, i) => (
                          <Star key={i} className="h-3.5 w-3.5 fill-brand-gold text-brand-gold" aria-hidden />
                        ))}
                      </p>
                    )}
                  </div>
                  {hotel.distanceToHaramM !== null && (
                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="h-4 w-4 text-brand" aria-hidden />
                      {t('card.distance', { distance: formatDistance(hotel.distanceToHaramM) })}
                    </p>
                  )}
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

      <PageCta locale={locale} content={content.cta} />
    </div>
  )
}
