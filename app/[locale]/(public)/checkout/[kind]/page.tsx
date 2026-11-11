import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { getSession } from '@/lib/auth/session'
import { getOnboardingState, isOnboardingComplete } from '@/lib/auth/contact'
import { safeNextPath, withNext } from '@/lib/auth/nextPath'
import { requireCatalog, type CatalogKey } from '@/lib/catalog/availability'
import { checkoutPath, isCheckoutKind, type CheckoutKind } from '@/lib/checkout/kinds'
import { loadCheckoutProduct } from '@/lib/checkout/options'
import { CHECKOUT_MAX_PEOPLE } from '@/lib/validators/checkout'
import { safeLocale } from '@/lib/utils/locale'
import { todayInApp } from '@/lib/time'
import { CheckoutForm } from './CheckoutForm'
import { ProductIntro } from './ProductIntro'

type Props = { params: Promise<{ locale: string; kind: string }>; searchParams: Promise<{ id?: string }> }

// Halaman pesan bukan untuk mesin pencari (berisi sesi pengguna, tak bermakna tanpa login).
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tm = await getTranslations({ locale: safeLocale((await params).locale), namespace: 'checkout.page' })
  return { title: tm('metaTitle'), robots: { index: false, follow: false } }
}

/** Jenis checkout → layanan katalog (layanan tanpa produk aktif = 404, sama dengan halaman katalognya — §7 V3). */
const CATALOG_OF: Record<CheckoutKind, CatalogKey> = { package: 'packages', visa: 'visa', transport: 'transport', haji: 'haji', hotel: 'hotels', tour: 'tours', muthowif: 'muthowif', catering: 'catering', flight: 'flight' }

// Checkout pelanggan satu produk (docs/arsitektur-booking-engine-v2.md §10.5). Belum login → login/daftar lalu KEMBALI ke sini (jalur kembali daftar putih,
// lib/auth/nextPath.ts); belum "Lengkapi data" → ke sana lalu kembali. Harga di halaman ini hanya petunjuk; angka yang mengikat = pratinjau server.
export default async function CheckoutPage({ params, searchParams }: Props) {
  const { locale: rawLocale, kind } = await params
  const locale = safeLocale(rawLocale)
  if (!isCheckoutKind(kind)) notFound()
  const id = (await searchParams).id ?? ''
  const here = checkoutPath(locale, kind, id)
  if (!safeNextPath(here)) notFound() // id bukan UUID (jalur yang sama dipakai sebagai jalur kembali login)
  await requireCatalog(CATALOG_OF[kind])

  const session = await getSession()
  if (!session) redirect(withNext(`/${locale}/login`, here))
  if (session.role === 'pilgrim') {
    const state = await getOnboardingState(session.userId)
    if (state && !isOnboardingComplete(state)) redirect(withNext(`/${locale}/lengkapi-data`, here))
  }

  const product = await loadCheckoutProduct(kind, id)
  if (!product) notFound()
  const t = await getTranslations({ locale, namespace: 'checkout' })
  // Nama layanan muthowif bukan data produk (satu layanan umum) — tampil dalam bahasa halaman.
  if (product.kind === 'muthowif') product.name = t('common.muthowifService')

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/${locale}/${CATALOG_OF[kind]}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden /> {t(`page.back.${kind}`)}
        </Link>
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-brand" aria-hidden /> {t('page.recalculated')}
        </p>
      </div>
      {session.role !== 'pilgrim' ? (
        <div className="space-y-5">
          <ProductIntro product={product} />
          <p className="checkout-panel text-sm text-muted-foreground">
            {t.rich('page.staffNote', { link: chunks => <Link href={`/${locale}/admin/bookings`} className="font-semibold text-brand hover:underline">{chunks}</Link> })}
          </p>
        </div>
      ) : (
        <CheckoutForm locale={locale} product={product} today={todayInApp()} maxPeople={CHECKOUT_MAX_PEOPLE} intro={<ProductIntro product={product} />} />
      )}
    </div>
  )
}
