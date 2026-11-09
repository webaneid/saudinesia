import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, Calendar, Check, Star, Tag, Users } from 'lucide-react'
import { prisma } from '@/lib/db'
import { requireCatalog } from '@/lib/catalog/availability'
import { getFeaturedCards } from '@/lib/media/urls'
import { hajiAvailable, hajiPriced } from '@/lib/haji/catalog'
import { sellPrices } from '@/lib/pricing/engine/read'
import { requirementsOfMany } from '@/lib/documents/requirements'
import { getPageContent, getPageText } from '@/lib/public-content/content'
import { catalogMetadata } from '@/lib/public-content/metadata'
import { DATE_LONG, formatCalendarDate } from '@/lib/time'
import { formatRupiah } from '@/lib/utils'
import { ProductImage } from '@/components/shared/ProductImage'
import { RequiredDocuments } from '@/components/shared/RequiredDocuments'
import { RichTextView } from '@/components/shared/rich-text/RichTextView'
import { PageHero, type HeroFact } from '@/components/shared/public/PageHero'
import { PageCta } from '@/components/shared/public/PageCta'
import { CatalogSection } from '@/components/shared/public/CatalogSection'
import { PriceTag } from '@/components/shared/public/PriceTag'

type Props = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return catalogMetadata((await params).locale, 'haji')
}

const HAJI_TYPES = ['furoda', 'khusus', 'reguler', 'plus'] as const
const INCLUDES_SHOWN = 4

// Katalog Paket Haji — pola katalog §6.7. Checkout Haji di browser belum ada (docs/arsitektur-haji.md §7): tombol tetap ke daftar akun.
export default async function HajiCatalogPage({ params }: Props) {
  const { locale } = await params
  await requireCatalog('haji')
  const [products, content, t] = await Promise.all([
    prisma.hajiProduct.findMany({ where: { isActive: true }, orderBy: [{ hajiType: 'asc' }, { year: 'asc' }, { id: 'asc' }] }),
    getPageContent(locale, 'haji'),
    getPageText(locale, 'haji'),
  ])
  const ids = products.map(p => p.id)
  const [covers, prices, reqs] = await Promise.all([
    getFeaturedCards('haji', ids),
    sellPrices('haji', ids),
    requirementsOfMany(ids.map(id => ({ productType: 'haji', productId: id }))),
  ])
  const typeLabel = (type: string) => ((HAJI_TYPES as readonly string[]).includes(type) ? t(`card.types.${type}`) : type)

  const byType = new Map<string, typeof products>()
  for (const p of products) byType.set(p.hajiType, [...(byType.get(p.hajiType) ?? []), p])

  const priced = ids.map(id => prices.get(id) ?? 0).filter(hajiPriced)
  const seats = products.reduce((sum, p) => sum + Math.max(0, hajiAvailable(p)), 0)
  const facts: HeroFact[] = []
  if (products.length > 0) {
    facts.push({ icon: Star, label: t('facts.count', { count: products.length }) })
    if (priced.length > 0) facts.push({ icon: Tag, label: t('facts.priceFrom', { price: formatRupiah(Math.min(...priced)) }) })
    if (seats > 0) facts.push({ icon: Users, label: t('facts.seats', { count: seats }) })
  }

  return (
    <div className="space-y-14">
      <PageHero locale={locale} content={content.hero} facts={facts} />

      <CatalogSection
        title={t('list.title')}
        description={t('list.description')}
        empty={{ icon: Star, text: t('list.empty') }}
        isEmpty={products.length === 0}
      >
        <div className="space-y-10">
          {[...byType.entries()].map(([type, items]) => (
            <div key={type} className="space-y-4">
              <div className="flex items-center gap-3">
                <h3 className="text-xl font-semibold text-brand-dark">{typeLabel(type)}</h3>
                <span className="catalog-chip">{t('card.groupCount', { count: items.length })}</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                {items.map(p => {
                  const sisa = hajiAvailable(p)
                  const price = prices.get(p.id) ?? 0
                  const includes = Array.isArray(p.includes) ? p.includes.filter((i): i is string => typeof i === 'string') : []
                  const cover = covers.get(p.id)
                  return (
                    <article key={p.id} className="catalog-card">
                      <ProductImage src={cover?.src} alt={cover?.alt} fallbackAlt={p.name} type="haji" />
                      <div className="flex flex-1 flex-col gap-4 p-5">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="catalog-chip">{typeLabel(p.hajiType)}</span>
                            <span className="text-xs text-muted-foreground">{t('card.year', { year: p.year })}</span>
                          </div>
                          <h4 className="text-lg font-semibold leading-snug text-brand-dark">{p.name}</h4>
                          <RichTextView value={p.description} className="text-sm text-muted-foreground" />
                        </div>

                        {p.departureDate && (
                          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Calendar className="h-4 w-4 text-brand" aria-hidden />
                            {formatCalendarDate(p.departureDate, DATE_LONG)}
                            {p.durationDays ? <span>· {t('card.days', { days: p.durationDays })}</span> : null}
                          </p>
                        )}

                        {includes.length > 0 && (
                          <ul className="space-y-1.5">
                            {includes.slice(0, INCLUDES_SHOWN).map(item => (
                              <li key={item} className="flex items-start gap-2 text-sm">
                                <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
                                <span>{item}</span>
                              </li>
                            ))}
                            {includes.length > INCLUDES_SHOWN && (
                              <li className="pl-6 text-xs text-muted-foreground">{t('card.more', { count: includes.length - INCLUDES_SHOWN })}</li>
                            )}
                          </ul>
                        )}

                        <RequiredDocuments requirements={reqs.get(`haji:${p.id}`) ?? []} />

                        <div className="mt-auto space-y-3 border-t pt-4">
                          <PriceTag
                            price={hajiPriced(price) ? price : null}
                            label={t('card.priceFrom')}
                            unit={t('card.perPerson')}
                            unpriced={t('card.unpriced')}
                          />
                          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Users className="h-4 w-4 text-brand" aria-hidden />
                            <span className={sisa < 10 ? 'font-medium text-destructive' : ''}>{t('card.seats', { count: Math.max(0, sisa) })}</span>
                          </p>
                          <Link href={`/${locale}/register`} className="btn-brand-solid w-full">
                            {t('card.register')} <ArrowRight className="h-4 w-4" aria-hidden />
                          </Link>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </CatalogSection>

      <PageCta locale={locale} content={content.cta} />
    </div>
  )
}
