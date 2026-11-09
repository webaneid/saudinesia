import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, Check, Package, ReceiptText, Tag } from 'lucide-react'
import { prisma } from '@/lib/db'
import { requireCatalog } from '@/lib/catalog/availability'
import { getFeaturedCards } from '@/lib/media/urls'
import { withSellPrice } from '@/lib/pricing/engine/read'
import { requirementsOfMany } from '@/lib/documents/requirements'
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
  return catalogMetadata((await params).locale, 'packages')
}

// Katalog Paket Umroh: acuan pola katalog (docs/arsitektur-frontend-publik.md §6 F4) — hero, daftar, CTA. Harga hanya harga jual (K4).
export default async function PackagesCatalogPage({ params }: Props) {
  const { locale } = await params
  await requireCatalog('packages')
  const [packages, content, t] = await Promise.all([
    prisma.package.findMany({
      where: { isActive: true },
      orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
    }).then(rows => withSellPrice('package', rows)),
    getPageContent(locale, 'packages'),
    getPageText(locale, 'packages'),
  ])
  const ids = packages.map(p => p.id)
  const [covers, reqs] = await Promise.all([
    getFeaturedCards('package', ids),
    requirementsOfMany(ids.map(id => ({ productType: 'package', productId: id }))),
  ])
  const hasAddOns = (p: (typeof packages)[number]) =>
    [p.hotelMakkahMode, p.hotelMadinahMode, p.transportMode, p.muthowifMode, p.visaMode, p.flightMode, p.cateringMode]
      .includes('user_choice')
  const priced = packages.map(p => Number(p.price)).filter(v => v > 0)

  const facts: HeroFact[] = []
  if (packages.length > 0) {
    facts.push({ icon: Package, label: t('facts.count', { count: packages.length }) })
    if (priced.length > 0) facts.push({ icon: Tag, label: t('facts.priceFrom', { price: formatRupiah(Math.min(...priced)) }) })
    facts.push({ icon: ReceiptText, label: t('facts.oneInvoice') })
  }

  return (
    <div className="space-y-14">
      <PageHero locale={locale} content={content.hero} facts={facts} />

      <CatalogSection
        title={t('list.title')}
        description={t('list.description')}
        empty={{ icon: Package, text: t('list.empty') }}
        isEmpty={packages.length === 0}
      >
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {packages.map(pkg => {
            const highlights = Array.isArray(pkg.highlights) ? pkg.highlights.filter((h): h is string => typeof h === 'string') : []
            const cover = covers.get(pkg.id)
            return (
              <article key={pkg.id} className={`catalog-card ${pkg.isFeatured ? 'border-brand ring-1 ring-brand' : ''}`}>
                <ProductImage src={cover?.src} alt={cover?.alt} fallbackAlt={pkg.name} type="package" />
                <div className="flex flex-1 flex-col gap-4 p-5">
                  {pkg.isFeatured && <span className="catalog-chip self-start">{t('card.featured')}</span>}
                  <div className="space-y-1">
                    <h3 className="text-lg font-semibold leading-snug text-brand-dark">{pkg.name}</h3>
                    <RichTextView value={pkg.description} className="text-sm text-muted-foreground" />
                  </div>

                  {highlights.length > 0 && (
                    <ul className="space-y-1.5">
                      {highlights.map(h => (
                        <li key={h} className="flex items-start gap-2 text-sm">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
                          <span>{h}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <RequiredDocuments requirements={reqs.get(`package:${pkg.id}`) ?? []} />

                  <div className="mt-auto space-y-3 border-t pt-4">
                    <PriceTag
                      price={Number(pkg.price)}
                      label={t('card.priceFrom')}
                      unit={pkg.priceLabel ?? t('card.perPerson')}
                      note={hasAddOns(pkg) ? t('card.addOns') : null}
                    />
                    {/* Checkout Paket belum ada (§1.2, §6.1): tetap ke daftar akun seperti sebelumnya. */}
                    <Link href={`/${locale}/register`} className="btn-brand-solid w-full">
                      {t('card.order')} <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
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
