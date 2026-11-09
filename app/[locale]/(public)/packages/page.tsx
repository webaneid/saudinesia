import type { Metadata } from 'next'
import Link from 'next/link'
import { hasLocale } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { ArrowRight, Check, Package, ReceiptText, Tag } from 'lucide-react'
import { routing } from '@/i18n/routing'
import { prisma } from '@/lib/db'
import { getFeaturedCards } from '@/lib/media/urls'
import { withSellPrice } from '@/lib/pricing/engine/read'
import { requirementsOfMany } from '@/lib/documents/requirements'
import { getPageContent } from '@/lib/public-content/content'
import { CATALOG_ANCHOR } from '@/lib/public-content/links'
import { localizedAlternates, ogAlternateLocales, ogLocale } from '@/lib/seo/site'
import { formatRupiah } from '@/lib/utils'
import { ProductImage } from '@/components/shared/ProductImage'
import { RequiredDocuments } from '@/components/shared/RequiredDocuments'
import { RichTextView } from '@/components/shared/rich-text/RichTextView'
import { PageHero, type HeroFact } from '@/components/shared/public/PageHero'
import { PageCta } from '@/components/shared/public/PageCta'

type Props = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) return {}
  const t = await getTranslations({ locale, namespace: 'catalog.packages.meta' })
  const title = t('title')
  const description = t('description')
  return {
    title,
    description,
    alternates: localizedAlternates(locale, 'packages'),
    openGraph: {
      type: 'website',
      siteName: 'Saudinesia',
      title,
      description,
      url: `/${locale}/packages`,
      locale: ogLocale(locale),
      alternateLocale: ogAlternateLocales(locale),
    },
    twitter: { card: 'summary', title, description },
  }
}

// Katalog Paket Umroh: acuan pola katalog (docs/arsitektur-frontend-publik.md §6 F4) — hero, daftar, CTA. Harga hanya harga jual (K4).
export default async function PackagesCatalogPage({ params }: Props) {
  const { locale } = await params
  const [packages, content, t] = await Promise.all([
    prisma.package.findMany({
      where: { isActive: true },
      orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
    }).then(rows => withSellPrice('package', rows)),
    getPageContent(locale, 'packages'),
    getTranslations({ locale, namespace: 'catalog.packages' }),
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

      <section id={CATALOG_ANCHOR} className="scroll-mt-24 space-y-6">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold tracking-tight text-brand-dark">{t('list.title')}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">{t('list.description')}</p>
        </div>

        {packages.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-16 text-center text-muted-foreground">
            <Package className="mx-auto mb-3 h-12 w-12 opacity-30" aria-hidden />
            <p>{t('list.empty')}</p>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {packages.map(pkg => {
              const highlights = Array.isArray(pkg.highlights) ? pkg.highlights.filter((h): h is string => typeof h === 'string') : []
              const price = Number(pkg.price)
              const cover = covers.get(pkg.id)
              return (
                <article
                  key={pkg.id}
                  className={`flex flex-col overflow-hidden rounded-2xl border bg-card transition-colors hover:border-brand ${pkg.isFeatured ? 'border-brand ring-1 ring-brand' : ''}`}
                >
                  <ProductImage src={cover?.src} alt={cover?.alt} fallbackAlt={pkg.name} type="package" />
                  <div className="flex flex-1 flex-col gap-4 p-5">
                    {pkg.isFeatured && (
                      <span className="self-start rounded-full bg-brand-light px-2.5 py-0.5 text-xs font-semibold text-brand">{t('card.featured')}</span>
                    )}
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
                      {price > 0 && (
                        <div>
                          <p className="text-xs text-muted-foreground">{t('card.priceFrom')}</p>
                          <p className="text-2xl font-bold text-brand">
                            {formatRupiah(price)}
                            <span className="text-sm font-normal text-muted-foreground"> {pkg.priceLabel ?? t('card.perPerson')}</span>
                          </p>
                          {hasAddOns(pkg) && <p className="mt-0.5 text-xs text-muted-foreground">{t('card.addOns')}</p>}
                        </div>
                      )}
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
        )}
      </section>

      <PageCta locale={locale} content={content.cta} />
    </div>
  )
}
