import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, Landmark, MapPin, Route as RouteIcon, Tag } from 'lucide-react'
import { prisma } from '@/lib/db'
import { requireCatalog } from '@/lib/catalog/availability'
import { checkoutPath } from '@/lib/checkout/kinds'
import { getFeaturedCards, getFeaturedCardUrls } from '@/lib/media/urls'
import { withSellPrice } from '@/lib/pricing/engine/read'
import { getPageContent, getPageText } from '@/lib/public-content/content'
import { catalogMetadata } from '@/lib/public-content/metadata'
import { safeExternalUrl } from '@/lib/public-content/links'
import { formatRupiah } from '@/lib/utils'
import { ProductImage } from '@/components/shared/ProductImage'
import { RichTextView } from '@/components/shared/rich-text/RichTextView'
import { PageHero, type HeroFact } from '@/components/shared/public/PageHero'
import { PageCta } from '@/components/shared/public/PageCta'
import { CatalogSection } from '@/components/shared/public/CatalogSection'
import { PriceTag } from '@/components/shared/public/PriceTag'

type Props = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return catalogMetadata((await params).locale, 'tours')
}

const CITIES = ['makkah', 'madinah', 'jeddah'] as const

// Katalog Paket Ziarah — pola katalog §6.7. Harga = jual paket dasar; kendaraan/hotel mode `user_choice` dibayar terpisah (docs/arsitektur-ziarah.md §12).
// Checkout Ziarah belum ada (§1.2): tombol tetap ke daftar akun.
export default async function ToursPage({ params }: Props) {
  const { locale } = await params
  await requireCatalog('tours')
  const [rows, content, t] = await Promise.all([
    prisma.tourPackage.findMany({
      where: { isActive: true },
      include: {
        transportTrip: { select: { origin: true, destination: true } },
        sites: { include: { tourismSite: true }, orderBy: { order: 'asc' } },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }),
    getPageContent(locale, 'tours'),
    getPageText(locale, 'tours'),
  ])
  const packages = (await withSellPrice('tour_package', rows)).sort((a, b) => a.price - b.price)
  const siteIds = [...new Set(packages.flatMap(p => p.sites.map(s => s.tourismSite.id)))]
  const [covers, sitePhotos] = await Promise.all([
    getFeaturedCards('tour_package', packages.map(p => p.id)),
    getFeaturedCardUrls('tourism_site', siteIds),
  ])
  const cityLabel = (c: string) => ((CITIES as readonly string[]).includes(c) ? t(`card.cities.${c}`) : c)

  const priced = packages.map(p => Number(p.price)).filter(v => v > 0)
  const facts: HeroFact[] = []
  if (packages.length > 0) {
    facts.push({ icon: Landmark, label: t('facts.count', { count: packages.length }) })
    if (siteIds.length > 0) facts.push({ icon: MapPin, label: t('facts.sites', { count: siteIds.length }) })
    if (priced.length > 0) facts.push({ icon: Tag, label: t('facts.priceFrom', { price: formatRupiah(Math.min(...priced)) }) })
  }

  return (
    <div className="space-y-14">
      <PageHero locale={locale} content={content.hero} facts={facts} />

      <CatalogSection
        title={t('list.title')}
        description={t('list.description')}
        empty={{ icon: Landmark, text: t('list.empty') }}
        isEmpty={packages.length === 0}
      >
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {packages.map(p => {
            const cover = covers.get(p.id)
            const transportChoice = p.transportMode === 'user_choice'
            const hotelChoice = p.hotelMode === 'user_choice'
            const addOns = transportChoice && hotelChoice ? t('card.addOnsBoth') : transportChoice ? t('card.addOnsTransport') : hotelChoice ? t('card.addOnsHotel') : null
            return (
              <article key={p.id} className="catalog-card">
                <ProductImage src={cover?.src} alt={cover?.alt} fallbackAlt={p.name} type="tour_package" />
                <div className="flex flex-1 flex-col gap-4 p-5">
                  <div className="space-y-2">
                    {transportChoice && p.transportTrip && (
                      <span className="catalog-chip">
                        <RouteIcon className="h-3 w-3" aria-hidden /> {p.transportTrip.origin} → {p.transportTrip.destination}
                      </span>
                    )}
                    <h3 className="text-lg font-semibold leading-snug text-brand-dark">{p.name}</h3>
                    <RichTextView value={p.description} className="text-sm text-muted-foreground" />
                  </div>

                  {p.sites.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('card.sites')}</p>
                      <ul className="space-y-2">
                        {p.sites.map(({ tourismSite: s }) => {
                          const photo = sitePhotos.get(s.id)
                          const map = safeExternalUrl(s.gmapsUrl)
                          return (
                            <li key={s.id} className="flex items-center gap-2.5 text-sm">
                              {photo ? (
                                // eslint-disable-next-line @next/next/no-img-element -- URL presigned MinIO (bucket private), sudah dikecilkan saat unggah
                                <img src={photo} alt={s.name} loading="lazy" decoding="async" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
                              ) : (
                                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-light">
                                  <MapPin className="h-4 w-4 text-brand" aria-hidden />
                                </span>
                              )}
                              <span className="min-w-0 flex-1">
                                {s.name}
                                {s.city && <span className="text-muted-foreground"> · {cityLabel(s.city)}</span>}
                              </span>
                              {map && (
                                <a href={map} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs font-semibold text-brand hover:underline">
                                  {t('card.map')}
                                </a>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )}

                  <div className="mt-auto space-y-3 border-t pt-4">
                    <PriceTag price={Number(p.price)} label={t('card.priceFrom')} note={addOns} />
                    {/* Checkout Paket Ziarah (docs/arsitektur-booking-engine-v2.md §10.6); paket belum berharga tak dapat dipesan. */}
                    {Number(p.price) > 0 && (
                      <Link href={checkoutPath(locale, 'tour', p.id)} className="btn-brand-solid w-full">
                        {t('card.order')} <ArrowRight className="h-4 w-4" aria-hidden />
                      </Link>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </CatalogSection>

      <PageCta locale={locale} content={content.cta} />
    </div>
  )
}
