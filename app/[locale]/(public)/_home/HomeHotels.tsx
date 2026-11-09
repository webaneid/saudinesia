import Link from 'next/link'
import { getPageText } from '@/lib/public-content/content'
import { MapPin, Star } from 'lucide-react'
import { ProductImage } from '@/components/shared/ProductImage'
import { formatDistance, formatRupiah } from '@/lib/utils'
import type { HomeData } from '@/lib/catalog/home'
import { HomeSectionHeader } from './HomeSectionHeader'

export async function HomeHotels({ locale, hotels }: { locale: string; hotels: HomeData['hotels'] }) {
  const cities = [
    { key: 'makkah', items: hotels.makkah },
    { key: 'madinah', items: hotels.madinah },
  ] as const
  if (cities.every(c => c.items.length === 0)) return null
  const t = await getPageText(locale, 'home', 'hotels')
  return (
    <section className="space-y-6">
      <HomeSectionHeader title={t('title')} description={t('description')} link={{ href: `/${locale}/hotels`, label: t('seeAll') }} />
      {cities.filter(c => c.items.length > 0).map(({ key, items }) => (
        <div key={key} className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">{t(key)}</h3>
          <div className="grid gap-4 md:grid-cols-3">
            {items.map(h => (
              <Link key={h.id} href={`/${locale}/hotels/${h.id}`} className="overflow-hidden rounded-2xl border bg-card transition-colors hover:border-brand">
                <ProductImage src={h.image?.src} alt={h.image?.alt} fallbackAlt={h.name} type="hotel" />
                <div className="space-y-2 p-5">
                  <p className="font-semibold leading-snug text-brand-dark">{h.name}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {h.stars !== null && h.stars > 0 && (
                      <span className="inline-flex items-center gap-0.5" aria-label={t('stars', { count: h.stars })}>
                        {Array.from({ length: h.stars }, (_, i) => (
                          <Star key={i} className="h-3 w-3 fill-brand-gold text-brand-gold" aria-hidden />
                        ))}
                      </span>
                    )}
                    {h.distanceToHaramM !== null && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" aria-hidden />
                        {t('distance', { distance: formatDistance(h.distanceToHaramM) })}
                      </span>
                    )}
                  </div>
                  {h.price !== null && (
                    <p className="text-sm font-semibold text-brand">
                      {t('priceFrom')} {formatRupiah(h.price)}
                      <span className="text-xs font-normal text-muted-foreground"> {t('perNight')}</span>
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}
