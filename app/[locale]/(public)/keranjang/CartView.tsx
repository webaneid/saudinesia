'use client'

import { useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, ShoppingCart, Trash2, UsersRound } from 'lucide-react'
import type { CatalogKey } from '@/lib/catalog/availability'
import type { RequiredComponentType } from '@/lib/validators/visa'
import { REQUIRED_COMPONENT_LABEL } from '@/lib/validators/visa'
import { cartBody, clearCart, readCart, removeFromCart, serverCart, setCartPeople, subscribeCart } from '@/lib/checkout/cartStore'
import { CheckoutSummary } from '../checkout/[kind]/CheckoutSummary'
import { PeopleStepper } from '../checkout/[kind]/PeopleStepper'
import { useCheckoutPreview } from '../checkout/[kind]/useCheckoutPreview'

/** Jenis komponen yang diwajibkan visa → katalog tempat menambahkannya (hanya ditautkan bila katalognya berproduk). */
const CATALOG_FOR: Record<RequiredComponentType, CatalogKey> = {
  flight: 'flight', hotel_makkah: 'hotels', hotel_madinah: 'hotels', transport: 'transport', muthowif: 'muthowif', tour: 'tours', catering: 'catering',
}
const CATALOG_LABEL: Record<CatalogKey, string> = {
  packages: 'Paket Umroh', haji: 'Haji', visa: 'Visa', flight: 'Tiket Pesawat', hotels: 'Hotel', transport: 'Transportasi', muthowif: 'Muthowif', tours: 'Paket Ziarah', catering: 'Katering',
}
const KIND_LABEL: Record<string, string> = {
  package: 'Paket Umroh', visa: 'Visa', transport: 'Transportasi', haji: 'Haji', hotel: 'Hotel', tour: 'Paket Ziarah', muthowif: 'Muthowif', catering: 'Katering', flight: 'Tiket Pesawat',
}

// Isi keranjang (perangkat) + satu jumlah jamaah untuk semua produk (satu rombongan, K11c-2) + ringkasan dari pratinjau server. Pesan = POST /bookings
// dengan seluruh isi; sukses → keranjang dikosongkan, ke detail booking untuk mengisi data jamaah dan membayar.
export function CartView({ locale, maxPeople, available }: { locale: string; maxPeople: number; available: CatalogKey[] }) {
  const router = useRouter()
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
      const json = await res.json() as { success: boolean; data?: { bookingId: string }; error?: string }
      if (!json.success || !json.data) { setSubmitError(json.error ?? 'Pesanan gagal dibuat — coba lagi'); return }
      clearCart()
      router.push(`/${locale}/bookings/${json.data.bookingId}?baru=1`)
    } catch {
      setSubmitError('Gagal menghubungi server — periksa koneksi internet')
    } finally {
      setSubmitting(false)
    }
  }

  if (cart.entries.length === 0) {
    return (
      <div className="checkout-panel py-10 text-center">
        <ShoppingCart className="mx-auto h-10 w-10 text-brand" aria-hidden />
        <p className="font-semibold text-brand-dark">Keranjang masih kosong</p>
        <p className="text-sm text-muted-foreground">Pilih produk dari katalog, lalu tekan &ldquo;Tambah ke keranjang&rdquo; untuk memesan beberapa layanan sekaligus.</p>
        <Link href={`/${locale}`} className="btn-brand-solid mx-auto">Lihat layanan <ArrowRight className="h-4 w-4" aria-hidden /></Link>
      </div>
    )
  }

  // Komponen yang diwajibkan visa tetapi belum ada → tautan ke katalognya (hanya katalog berproduk).
  const missingTypes = preview.status === 'error' ? [...new Set(preview.violations.flatMap(v => (v.missing === 'rule' ? [] : [v.missing])))] : []
  const links = [...new Set(missingTypes.map(t => CATALOG_FOR[t]))].filter(k => available.includes(k))

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="min-w-0 space-y-5">
        <div className="checkout-panel">
          <label htmlFor="cart-people" className="checkout-label flex items-center gap-1.5"><UsersRound className="h-4 w-4 text-brand" aria-hidden /> Jumlah jamaah (satu rombongan)</label>
          <PeopleStepper id="cart-people" value={cart.people} onChange={setCartPeople} max={maxPeople} />
          <p className="text-xs text-muted-foreground">Berlaku untuk semua produk di keranjang. Jumlah kamar hotel tidak ikut berubah — sesuaikan bila perlu.</p>
        </div>

        <ul className="space-y-3">
          {cart.entries.map(e => (
            <li key={e.id} className="checkout-panel flex items-start justify-between gap-3 space-y-0">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand">{KIND_LABEL[e.kind]}</p>
                <p className="font-semibold text-foreground">{e.title}</p>
                <p className="text-sm text-muted-foreground">{e.summary}</p>
              </div>
              <button type="button" onClick={() => removeFromCart(e.id)} aria-label={`Hapus ${e.title} dari keranjang`}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border text-destructive transition-colors hover:border-destructive">
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>

        {missingTypes.length > 0 && (
          <div className="checkout-panel text-sm">
            <p className="font-semibold text-brand-dark">Lengkapi keranjang</p>
            <p className="text-muted-foreground">Visa di keranjang mewajibkan: {missingTypes.map(t => REQUIRED_COMPONENT_LABEL[t]).join(', ')}.</p>
            {links.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {links.map(k => <Link key={k} href={`/${locale}/${k}`} className="btn-brand-outline">{CATALOG_LABEL[k]} <ArrowRight className="h-4 w-4" aria-hidden /></Link>)}
              </div>
            )}
          </div>
        )}
      </div>
      <aside className="min-w-0">
        <CheckoutSummary preview={preview} missing={null} submitting={submitting} submitError={submitError} onSubmit={submit} />
      </aside>
    </div>
  )
}

