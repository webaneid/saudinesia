import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Check } from 'lucide-react'
import { ProductImage } from '@/components/shared/ProductImage'
import { formatRupiah } from '@/lib/utils'
import type { HomePackage } from '@/lib/catalog/home'
import { HomeSectionHeader } from './HomeSectionHeader'

export async function HomePackages({ locale, packages }: { locale: string; packages: HomePackage[] }) {
  if (packages.length === 0) return null
  const t = await getTranslations({ locale, namespace: 'home.packages' })
  const href = `/${locale}/packages`
  return (
    <section className="space-y-6">
      <HomeSectionHeader title={t('title')} description={t('description')} link={{ href, label: t('seeAll') }} />
      <div className="grid gap-4 md:grid-cols-3">
        {packages.map(p => (
          <Link key={p.id} href={href} className="group overflow-hidden rounded-2xl border bg-card transition-colors hover:border-brand">
            <ProductImage src={p.image?.src} alt={p.image?.alt} fallbackAlt={p.name} type="package" />
            <div className="space-y-3 p-5">
              {p.isFeatured && <span className="inline-block rounded-full bg-brand-light px-2.5 py-0.5 text-xs font-semibold text-brand">{t('featured')}</span>}
              <p className="font-semibold leading-snug text-brand-dark">{p.name}</p>
              {p.highlights.length > 0 && (
                <ul className="space-y-1.5">
                  {p.highlights.map(h => (
                    <li key={h} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              )}
              {p.price !== null && (
                <div className="border-t pt-3">
                  <p className="text-xs text-muted-foreground">{t('priceFrom')}</p>
                  <p className="text-xl font-bold text-brand">
                    {formatRupiah(p.price)}
                    <span className="text-xs font-normal text-muted-foreground"> {p.priceLabel ?? t('perPerson')}</span>
                  </p>
                  {p.hasAddOns && <p className="mt-0.5 text-xs text-muted-foreground">{t('addOns')}</p>}
                </div>
              )}
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
