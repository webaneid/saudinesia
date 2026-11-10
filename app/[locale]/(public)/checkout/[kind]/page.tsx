import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
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
export const metadata: Metadata = { title: 'Checkout', robots: { index: false, follow: false } }

/** Jenis checkout → layanan katalog (layanan tanpa produk aktif = 404, sama dengan halaman katalognya — §7 V3). */
const CATALOG_OF: Record<CheckoutKind, CatalogKey> = { package: 'packages', visa: 'visa', transport: 'transport', haji: 'haji', hotel: 'hotels', tour: 'tours', muthowif: 'muthowif', catering: 'catering', flight: 'flight' }
const BACK: Record<CheckoutKind, { href: string; label: string }> = {
  package: { href: 'packages', label: 'Kembali ke Paket Umroh' },
  visa: { href: 'visa', label: 'Kembali ke Visa' },
  transport: { href: 'transport', label: 'Kembali ke Transportasi' },
  haji: { href: 'haji', label: 'Kembali ke Haji' },
  hotel: { href: 'hotels', label: 'Kembali ke Hotel' },
  tour: { href: 'tours', label: 'Kembali ke Paket Ziarah' },
  muthowif: { href: 'muthowif', label: 'Kembali ke Muthowif' },
  catering: { href: 'catering', label: 'Kembali ke Katering' },
  flight: { href: 'flight', label: 'Kembali ke Tiket Pesawat' },
}

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

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/${locale}/${BACK[kind].href}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden /> {BACK[kind].label}
        </Link>
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-brand" aria-hidden /> Harga dihitung ulang oleh sistem saat Anda memesan
        </p>
      </div>
      {session.role !== 'pilgrim' ? (
        <div className="space-y-5">
          <ProductIntro product={product} />
          <p className="checkout-panel text-sm text-muted-foreground">Anda masuk sebagai staf. Pesanan untuk pelanggan dibuat lewat <Link href={`/${locale}/admin/bookings`} className="font-semibold text-brand hover:underline">form booking admin</Link>.</p>
        </div>
      ) : (
        <CheckoutForm locale={locale} product={product} today={todayInApp()} maxPeople={CHECKOUT_MAX_PEOPLE} intro={<ProductIntro product={product} />} />
      )}
    </div>
  )
}
