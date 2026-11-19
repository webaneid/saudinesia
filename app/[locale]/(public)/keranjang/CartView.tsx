'use client'

import { useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ArrowRight, ShoppingCart, Trash2 } from 'lucide-react'
import type { CatalogKey } from '@/lib/catalog/availability'
import type { RequiredComponentType } from '@/lib/validators/visa'
import { cartBody, clearCart, entryInput, isGroupedCart, readCart, removeFromCart, serverCart, setEntryGroup, subscribeCart } from '@/lib/checkout/cartStore'
import { groupMark } from '@/lib/booking/groupNames'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { GroupsPanel } from './GroupsPanel'
import { CheckoutSummary } from '../checkout/[kind]/CheckoutSummary'
import { useCheckoutPreview } from '../checkout/[kind]/useCheckoutPreview'
import { entrySummary } from '../checkout/[kind]/fields'
import { useApiError } from '@/components/shared/useApiError'

/** Jenis komponen yang diwajibkan visa → katalog tempat menambahkannya (hanya ditautkan bila katalognya berproduk). */
const CATALOG_FOR: Record<RequiredComponentType, CatalogKey> = {
  flight: 'flight', hotel_makkah: 'hotels', hotel_madinah: 'hotels', transport: 'transport', muthowif: 'muthowif', tour: 'tours', catering: 'catering',
}

// Isi keranjang (perangkat) + jumlah jamaah (satu rombongan, K11c-2; beberapa rombongan sejak 11d-3 — `GroupsPanel` + pilihan sasaran per produk) + ringkasan dari pratinjau server. Pesan = POST /bookings
// dengan seluruh isi; sukses → keranjang dikosongkan, ke detail booking untuk mengisi data jamaah dan membayar.
const ALL = 'all'

export function CartView({ locale, maxPeople, available, orderBlocked = false }: { locale: string; maxPeople: number; available: CatalogKey[]; orderBlocked?: boolean }) {
  const router = useRouter()
  const t = useTranslations('cart')
  const tc = useTranslations('checkout')
  const errorText = useApiError()
  const cart = useSyncExternalStore(subscribeCart, readCart, serverCart)
  const body = cartBody(cart)
  const preview = useCheckoutPreview(body)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  async function submit() {
    if (!body) return
    setSubmitting(true)
    setSubmitError('')
    try {
      const res = await fetch('/api/v1/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json() as { success: boolean; data?: { bookingId: string } }
      if (!json.success || !json.data) { setSubmitError(errorText(json, tc('form.orderFailed'))); return }
      clearCart()
      router.push(`/${locale}/bookings/${json.data.bookingId}?baru=1`)
    } catch {
      setSubmitError(tc('form.network'))
    } finally {
      setSubmitting(false)
    }
  }

  if (cart.entries.length === 0) {
    return (
      <div className="checkout-panel py-10 text-center">
        <ShoppingCart className="mx-auto h-10 w-10 text-brand" aria-hidden />
        <p className="font-semibold text-brand-dark">{t('emptyTitle')}</p>
        <p className="text-sm text-muted-foreground">{t('emptyHint')}</p>
        <Link href={`/${locale}`} className="btn-brand-solid mx-auto">{t('browse')} <ArrowRight className="h-4 w-4" aria-hidden /></Link>
      </div>
    )
  }

  // Rombongan (11d-3): setiap produk memilih sasarannya — semua jamaah atau satu rombongan (visa wajib satu rombongan).
  const grouped = isGroupedCart(cart)
  const groupOptions = cart.groups.map((g, i) => ({ id: String(i), label: g.label.trim() || t('groupUnnamed', { mark: groupMark(i) }) }))

  // Komponen yang diwajibkan visa tetapi belum ada → tautan ke katalognya (hanya katalog berproduk).
  const missingTypes = preview.status === 'error' ? [...new Set(preview.violations.flatMap(v => (v.missing === 'rule' ? [] : [v.missing])))] : []
  const links = [...new Set(missingTypes.map(t => CATALOG_FOR[t]))].filter(k => available.includes(k))

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="min-w-0 space-y-5">
        <GroupsPanel cart={cart} maxPeople={maxPeople} />

        <ul className="space-y-3">
          {cart.entries.map(e => {
            // Ringkasan dan nama layanan muthowif dibangun dalam bahasa halaman (bukan teks yang tersimpan di perangkat).
            const title = e.kind === 'muthowif' ? tc('common.muthowifService') : e.title
            const summary = entrySummary(entryInput(cart, e), locale)
            return (
            <li key={e.id} className="checkout-panel flex items-start justify-between gap-3 space-y-0">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand">{tc(`kinds.${e.kind}`)}</p>
                <p className="font-semibold text-foreground">{title}</p>
                <p className="text-sm text-muted-foreground">{tc(`entry.${summary.key}`, summary.values)}</p>
                {grouped && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold text-brand-dark">{t('forLabel')}:</span>
                    <ChoiceSelect
                      className="min-w-48"
                      ariaLabel={t('forGroup', { title })}
                      options={[...(e.kind === 'visa' ? [] : [{ id: ALL, label: t('forAll') }]), ...groupOptions]}
                      value={e.group === undefined ? (e.kind === 'visa' ? '' : ALL) : String(e.group)}
                      onChange={v => setEntryGroup(e.id, v === ALL || v === '' ? undefined : Number(v))}
                      clearable={false}
                    />
                  </div>
                )}
              </div>
              <button type="button" onClick={() => removeFromCart(e.id)} aria-label={t('remove', { title })}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border text-destructive transition-colors hover:border-destructive">
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </li>
            )
          })}
        </ul>

        {missingTypes.length > 0 && (
          <div className="checkout-panel text-sm">
            <p className="font-semibold text-brand-dark">{t('completeTitle')}</p>
            <p className="text-muted-foreground">{t('requires', { items: missingTypes.map(x => tc(`components.${x}`)).join(', ') })}</p>
            {links.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {links.map(k => <Link key={k} href={`/${locale}/${k}`} className="btn-brand-outline">{t(`catalogs.${k}`)} <ArrowRight className="h-4 w-4" aria-hidden /></Link>)}
              </div>
            )}
          </div>
        )}
      </div>
      <aside className="min-w-0">
        <CheckoutSummary preview={preview} missing={null} submitting={submitting} submitError={submitError} onSubmit={submit} orderBlocked={orderBlocked} />
      </aside>
    </div>
  )
}

