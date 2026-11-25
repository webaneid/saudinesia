import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { hasLocale } from 'next-intl'
import { ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, Clock, MinusCircle, Route } from 'lucide-react'
import { routing } from '@/i18n/routing'
import { prisma } from '@/lib/db'
import { requireCatalog } from '@/lib/catalog/availability'
import { loadCheckoutProduct } from '@/lib/checkout/options'
import { checkoutPath } from '@/lib/checkout/kinds'
import { packageCatalogRequirements } from '@/lib/documents/requirements'
import { getPageText } from '@/lib/public-content/content'
import { localizedAlternates } from '@/lib/seo/site'
import { plainText } from '@/lib/rich-text/doc'
import { readExclusions, readItinerary } from '@/lib/validators/package'
import { formatCalendarDate, DATE_LONG } from '@/lib/time'
import { formatRupiah } from '@/lib/utils'
import { ProductImage } from '@/components/shared/ProductImage'
import { RequiredDocuments } from '@/components/shared/RequiredDocuments'
import { RichTextView } from '@/components/shared/rich-text/RichTextView'
import { PriceTag } from '@/components/shared/public/PriceTag'

type Props = { params: Promise<{ locale: string; id: string }> }

const UUID = /^[0-9a-f-]{36}$/i

// Detail publik Paket Umroh (K1 F5, docs/arsitektur-paket-umroh.md §8.5): data dari pemuat checkout yang sama (isi termasuk, keberangkatan berharga,
// alasan tak bisa dipesan) + rencana perjalanan (hari ≤ durasi) + "tidak termasuk" + syarat dokumen. Harga hanya harga jual; catatan internal keberangkatan tak pernah tampil.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params
  if (!hasLocale(routing.locales, locale) || !UUID.test(id)) return {}
  const pkg = await prisma.package.findUnique({ where: { id, isActive: true }, select: { id: true, name: true, description: true } })
  if (!pkg) return {}
  const description = plainText(pkg.description).slice(0, 160)
  return { title: pkg.name, ...(description && { description }), alternates: localizedAlternates(locale, `packages/${pkg.id}`) }
}

export default async function PackageDetailPage({ params }: Props) {
  const { locale, id } = await params
  await requireCatalog('packages')
  if (!UUID.test(id)) notFound()
  const [product, extra, reqs, t] = await Promise.all([
    loadCheckoutProduct('package', id),
    prisma.package.findUnique({ where: { id, isActive: true }, select: { itinerary: true, exclusions: true } }),
    packageCatalogRequirements([id]),
    getPageText(locale, 'packages', 'detail'),
  ])
  if (!product || product.kind !== 'package' || !extra) notFound()

  const duration = product.durationDays
  const itinerary = readItinerary(extra.itinerary).filter(d => duration == null || d.day <= duration)
  const exclusions = readExclusions(extra.exclusions)
  const day = (d: string) => formatCalendarDate(d, DATE_LONG, locale)
  const canOrder = product.blocked == null
  const open = product.departures.filter(d => d.seatsLeft > 0 && (d.priceIdr ?? 0) > 0)

  return (
    <div className="space-y-10">
      <Link href={`/${locale}/packages`} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {t('back')}
      </Link>

      <section className="grid gap-6 lg:grid-cols-2">
        <ProductImage src={product.cover?.src} alt={product.cover?.alt} fallbackAlt={product.name} type="package" className="rounded-2xl" />
        <div className="flex flex-col gap-4">
          <h1 className="text-2xl font-bold leading-tight text-brand-dark sm:text-3xl">{product.name}</h1>
          {duration != null && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Clock className="h-4 w-4 text-brand" aria-hidden /> {t('duration', { days: duration })}</p>
          )}
          <RichTextView value={product.description} className="text-sm text-muted-foreground" />
          <div className="mt-auto space-y-3 border-t pt-4">
            <PriceTag price={product.pricePerPerson} label={t('priceFrom')} unit={t('perPerson')} note={null} />
            {canOrder && open.length > 0 && (
              <a href="#departures" className="btn-brand-solid w-full sm:w-auto">{t('pickDeparture')} <ArrowRight className="h-4 w-4" aria-hidden /></a>
            )}
            {!canOrder && <p className="text-sm text-muted-foreground">{t('notBookable')}</p>}
          </div>
        </div>
      </section>

      {(product.included.length > 0 || exclusions.length > 0) && (
        <section className="grid gap-6 md:grid-cols-2">
          {product.included.length > 0 && (
            <div className="space-y-3 rounded-2xl border p-5">
              <h2 className="text-lg font-semibold text-brand-dark">{t('included')}</h2>
              <ul className="space-y-2">
                {product.included.map(x => (
                  <li key={x.key} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden /> {t(`includedItem.${x.key}`, { nights: x.nights ?? 0 })}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {exclusions.length > 0 && (
            <div className="space-y-3 rounded-2xl border p-5">
              <h2 className="text-lg font-semibold text-brand-dark">{t('excluded')}</h2>
              <ul className="space-y-2">
                {exclusions.map(x => (
                  <li key={x} className="flex items-start gap-2 text-sm"><MinusCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /> {x}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {itinerary.length > 0 && (
        <section className="space-y-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-brand-dark"><Route className="h-5 w-5 text-brand" aria-hidden /> {t('itinerary')}</h2>
          <ol className="space-y-3">
            {itinerary.map(d => (
              <li key={d.day} className="flex gap-4 rounded-2xl border p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">{d.day}</span>
                <div className="min-w-0 space-y-1">
                  <p className="font-semibold text-brand-dark">{t('day', { day: d.day })} — {d.title}</p>
                  {d.body && <p className="whitespace-pre-line text-sm text-muted-foreground">{d.body}</p>}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section id="departures" className="scroll-mt-24 space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-brand-dark"><CalendarDays className="h-5 w-5 text-brand" aria-hidden /> {t('departures')}</h2>
        {product.departures.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">{t('noDepartures')}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {product.departures.map(d => {
              const full = d.seatsLeft < 1
              const priced = (d.priceIdr ?? 0) > 0
              return (
                <li key={d.id} className={`flex flex-col gap-3 rounded-2xl border p-4 ${full ? 'opacity-60' : ''}`}>
                  <div>
                    <p className="font-semibold text-brand-dark">{t('departureRange', { from: day(d.departureDate), to: day(d.returnDate) })}</p>
                    <p className="text-xs text-muted-foreground">{full ? t('soldOut') : t('seatsLeft', { seats: d.seatsLeft })}</p>
                  </div>
                  {priced && <p className="text-base font-bold text-brand">{formatRupiah(d.priceIdr!)} <span className="text-xs font-normal text-muted-foreground">{t('perPerson')}</span></p>}
                  {canOrder && !full && priced && (
                    <Link href={checkoutPath(locale, 'package', product.id, { departure: d.id })} className="btn-brand-solid mt-auto w-full">
                      {t('order')} <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <RequiredDocuments requirements={reqs.get(id)?.requirements ?? []} visaChoice={reqs.get(id)?.visaChoice} />
    </div>
  )
}
