import type { Metadata } from 'next'
import { checkoutPath } from '@/lib/checkout/kinds'
import Link from 'next/link'
import { ArrowRight, Clock, Globe, Info, KeyRound, Tag } from 'lucide-react'
import { prisma } from '@/lib/db'
import { requireCatalog } from '@/lib/catalog/availability'
import { getFeaturedCards } from '@/lib/media/urls'
import { requirementsOfMany } from '@/lib/documents/requirements'
import { visaPriceSummary } from '@/lib/pricing/engine/read'
import { parseRequiredComponents, visaSalesModel } from '@/lib/validators/visa'
import { getPageContent, getPageText } from '@/lib/public-content/content'
import { catalogMetadata } from '@/lib/public-content/metadata'
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
  return catalogMetadata((await params).locale, 'visa')
}

// Katalog Visa — pola katalog §6.7. Visa tunggal dipesan lewat checkout Visa; visa plus wajib bersama produk lain (lib/booking/rules.ts) → lewat admin.
export default async function VisaCatalogPage({ params }: Props) {
  const { locale } = await params
  await requireCatalog('visa')
  const [products, content, t] = await Promise.all([
    prisma.visaProduct.findMany({ where: { isActive: true }, orderBy: [{ country: 'asc' }, { visaType: 'asc' }, { id: 'asc' }] }),
    getPageContent(locale, 'visa'),
    getPageText(locale, 'visa'),
  ])
  const ids = products.map(p => p.id)
  const [reqs, covers, priceSummary] = await Promise.all([
    requirementsOfMany(ids.map(id => ({ productType: 'visa', productId: id }))),
    getFeaturedCards('visa', ids),
    visaPriceSummary(ids),
  ])

  const grouped = new Map<string, typeof products>()
  for (const p of products) {
    const key = p.country || 'Saudi Arabia'
    grouped.set(key, [...(grouped.get(key) ?? []), p])
  }

  const priced = ids.map(id => priceSummary.get(id)?.from ?? 0).filter(v => v > 0)
  const days = products.map(p => p.processDays).filter(d => d > 0)
  const facts: HeroFact[] = []
  if (products.length > 0) {
    facts.push({ icon: KeyRound, label: t('facts.count', { count: products.length }) })
    if (priced.length > 0) facts.push({ icon: Tag, label: t('facts.priceFrom', { price: formatRupiah(Math.min(...priced)) }) })
    if (days.length > 0) facts.push({ icon: Clock, label: t('facts.process', { days: Math.min(...days) }) })
  }

  return (
    <div className="space-y-14">
      <PageHero locale={locale} content={content.hero} facts={facts} />

      <CatalogSection
        title={t('list.title')}
        description={t('list.description')}
        empty={{ icon: KeyRound, text: t('list.empty') }}
        isEmpty={products.length === 0}
      >
        <div className="space-y-10">
          {[...grouped.entries()].map(([country, items]) => (
            <div key={country} className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-brand-dark">
                <Globe className="h-4 w-4 text-brand" aria-hidden />
                <span>{country}</span>
                <div className="ml-2 h-px flex-1 bg-border" />
              </div>

              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                {items.map(v => {
                  const summary = priceSummary.get(v.id) ?? { from: 0, isRange: false }
                  const model = visaSalesModel(parseRequiredComponents(v.requiredComponents).components)
                  const cover = covers.get(v.id)
                  return (
                    <article key={v.id} className="catalog-card">
                      <ProductImage src={cover?.src} alt={cover?.alt} fallbackAlt={v.name} type="visa" />
                      <div className="flex flex-1 flex-col gap-4 p-5">
                        <div className="space-y-2">
                          <span className="catalog-chip">{v.visaType}</span>
                          <h3 className="text-lg font-semibold leading-snug text-brand-dark">{v.name}</h3>
                          <RichTextView value={v.description} className="text-sm text-muted-foreground" />
                        </div>

                        {v.processDays > 0 && (
                          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Clock className="h-4 w-4 text-brand" aria-hidden />
                            {t('card.process', { days: v.processDays })}
                          </p>
                        )}

                        <RequiredDocuments requirements={reqs.get(`visa:${v.id}`) ?? []} />

                        <div className="mt-auto space-y-3 border-t pt-4">
                          <PriceTag
                            price={summary.from}
                            label={summary.isRange ? t('card.priceFrom') : null}
                            unit={v.priceLabel ?? t('card.perPerson')}
                          />
                          {model.plus ? (
                            <p className="flex items-start gap-2 text-xs text-muted-foreground">
                              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                              <span>{t('card.bundled', { parts: model.parts.join(', ') })}</span>
                            </p>
                          ) : summary.from > 0 ? (
                            <Link href={checkoutPath(locale, 'visa', v.id)} className="btn-brand-solid w-full">
                              {t('card.apply')} <ArrowRight className="h-4 w-4" aria-hidden />
                            </Link>
                          ) : null}
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
