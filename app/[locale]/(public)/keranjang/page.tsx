import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { ShieldCheck } from 'lucide-react'
import { getSession } from '@/lib/auth/session'
import { getOnboardingState, isOnboardingComplete } from '@/lib/auth/contact'
import { withNext } from '@/lib/auth/nextPath'
import { availableCatalogs, isCatalogKey } from '@/lib/catalog/availability'
import { CHECKOUT_MAX_PEOPLE } from '@/lib/validators/checkout'
import { hasActiveBankAccount } from '@/lib/invoice/banks'
import { safeLocale } from '@/lib/utils/locale'
import { CartView } from './CartView'

type Props = { params: Promise<{ locale: string }> }

// Berisi sesi pengguna dan isi perangkat — bukan untuk mesin pencari.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: safeLocale((await params).locale), namespace: 'cart' })
  return { title: t('metaTitle'), robots: { index: false, follow: false } }
}

// Keranjang pelanggan (docs/arsitektur-booking-engine-v2.md §10.7): isi tersimpan DI PERANGKAT (lib/checkout/cartStore.ts), harga dan aturan dari
// pratinjau server (mesin pesan yang sama), pesan = SATU booking + SATU invoice. Gerbang sesi sama dengan halaman checkout.
export default async function CartPage({ params }: Props) {
  const locale = safeLocale((await params).locale)
  const here = `/${locale}/keranjang`
  const session = await getSession()
  if (!session) redirect(withNext(`/${locale}/login`, here))
  if (session.role === 'pilgrim') {
    const state = await getOnboardingState(session.userId)
    if (state && !isOnboardingComplete(state)) redirect(withNext(`/${locale}/lengkapi-data`, here))
  }
  const available = [...await availableCatalogs()].filter(isCatalogKey)
  const canOrder = await hasActiveBankAccount()
  const t = await getTranslations({ locale, namespace: 'cart' })
  const tp = await getTranslations({ locale, namespace: 'checkout.page' })

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold text-brand-dark">{t('title')}</h1>
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-brand" aria-hidden /> {tp('recalculated')}
        </p>
      </div>
      {session.role !== 'pilgrim' ? (
        <p className="checkout-panel text-sm text-muted-foreground">
          {tp.rich('staffNote', { link: chunks => <Link href={`/${locale}/admin/bookings`} className="font-semibold text-brand hover:underline">{chunks}</Link> })}
        </p>
      ) : (
        <CartView locale={locale} maxPeople={CHECKOUT_MAX_PEOPLE} available={available} orderBlocked={!canOrder} />
      )}
    </div>
  )
}
