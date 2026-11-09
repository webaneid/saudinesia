import Link from 'next/link'
import { checkoutPath } from '@/lib/checkout/kinds'
import { getPageText } from '@/lib/public-content/content'
import { ArrowRight, Clock } from 'lucide-react'
import { ProductImage } from '@/components/shared/ProductImage'
import { formatRupiah } from '@/lib/utils'
import type { HomeVisa as HomeVisaItem } from '@/lib/catalog/home'
import { HomeSectionHeader } from './HomeSectionHeader'

// Satu-satunya bagian dengan tombol beli langsung, dan hanya untuk visa yang benar-benar bisa lewat checkout pendek (§1.2 rencana).
export async function HomeVisa({ locale, visas }: { locale: string; visas: HomeVisaItem[] }) {
  if (visas.length === 0) return null
  const t = await getPageText(locale, 'home', 'visa')
  const catalog = `/${locale}/visa`
  return (
    <section className="space-y-6">
      <HomeSectionHeader title={t('title')} description={t('description')} link={{ href: catalog, label: t('seeAll') }} />
      <div className="grid gap-4 md:grid-cols-3">
        {visas.map(v => (
          <div key={v.id} className="flex flex-col overflow-hidden rounded-2xl border bg-card">
            <ProductImage src={v.image?.src} alt={v.image?.alt} fallbackAlt={v.name} type="visa" />
            <div className="flex flex-1 flex-col gap-3 p-5">
              <div className="space-y-1">
                <p className="font-semibold leading-snug text-brand-dark">{v.name}</p>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" aria-hidden />
                  {t('processDays', { days: v.processDays })}
                </p>
              </div>
              {v.price !== null && (
                <p className="text-xl font-bold text-brand">
                  {v.isRange && <span className="text-xs font-normal text-muted-foreground">{t('priceFrom')} </span>}
                  {formatRupiah(v.price)}
                  <span className="text-xs font-normal text-muted-foreground"> {v.priceLabel ?? t('perPerson')}</span>
                </p>
              )}
              <div className="mt-auto border-t pt-3">
                {v.canBuyDirectly ? (
                  <Link
                    href={checkoutPath(locale, 'visa', v.id)}
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-dark"
                  >
                    {t('apply')} <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                ) : (
                  <Link
                    href={catalog}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border px-4 text-sm font-semibold text-brand-dark transition-colors hover:border-brand"
                  >
                    {t('details')}
                  </Link>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
