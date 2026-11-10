'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, ShoppingCart } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { CheckoutProduct } from '@/lib/checkout/options'
import type { CheckoutInput } from '@/lib/validators/checkout'
import { CheckoutSummary } from './CheckoutSummary'
import { PackageFields } from './PackageFields'
import { VisaFields } from './VisaFields'
import { TransportFields } from './TransportFields'
import { HajiFields } from './HajiFields'
import { HotelFields } from './HotelFields'
import { TourFields } from './TourFields'
import { MuthowifFields } from './MuthowifFields'
import { CateringFields } from './CateringFields'
import { FlightFields } from './FlightFields'
import { useCheckoutPreview } from './useCheckoutPreview'
import { entrySummary } from './fields'
import { addToCart } from '@/lib/checkout/cartStore'

type Props = { locale: string; product: CheckoutProduct; today: string; maxPeople: number; intro: React.ReactNode }

// Orkestrator checkout (docs/arsitektur-booking-engine-v2.md §10.5): isian per jenis → masukan checkout → pratinjau server → pesan (POST /bookings).
// Sukses → detail booking (`?baru=1`) untuk mengisi data jamaah dan membayar. "Pesan sekarang" = keranjang satu entri; "Tambah ke keranjang" menyimpan
// pilihan yang sama di perangkat (lib/checkout/cartStore.ts, §10.7) untuk digabung dengan produk lain — Haji selalu dipesan sendiri.
export function CheckoutForm({ locale, product, today, maxPeople, intro }: Props) {
  const router = useRouter()
  const [input, setInput] = useState<CheckoutInput | null>(null)
  const [missing, setMissing] = useState<string | null>('Lengkapi pilihan pesanan')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [cartNote, setCartNote] = useState<{ ok: boolean; text: string } | null>(null)
  const body = useMemo(() => (input ? { items: [input] } : null), [input])
  const preview = useCheckoutPreview(body)

  const onChange = useCallback((next: CheckoutInput | null, why: string | null) => {
    setInput(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    setMissing(why)
    setSubmitError('')
    setCartNote(null)
  }, [])

  function addCart() {
    if (!input || missing) return
    const refusal = addToCart({ kind: product.kind, productId: product.id, title: product.name, summary: entrySummary(input), input })
    setCartNote(refusal ? { ok: false, text: refusal } : { ok: true, text: 'Ditambahkan ke keranjang' })
  }

  async function submit() {
    if (!input) return
    setSubmitting(true)
    setSubmitError('')
    try {
      const res = await fetch('/api/v1/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json() as { success: boolean; data?: { bookingId: string }; error?: string }
      if (!json.success || !json.data) { setSubmitError(json.error ?? 'Pesanan gagal dibuat — coba lagi'); return }
      router.push(`/${locale}/bookings/${json.data.bookingId}?baru=1`)
    } catch {
      setSubmitError('Gagal menghubungi server — periksa koneksi internet')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="min-w-0 space-y-5">
        {intro}
        {product.kind === 'package' && <PackageFields product={product} today={today} maxPeople={maxPeople} onChange={onChange} />}
        {product.kind === 'visa' && <VisaFields product={product} today={today} maxPeople={maxPeople} onChange={onChange} />}
        {product.kind === 'transport' && <TransportFields product={product} maxPeople={maxPeople} onChange={onChange} />}
        {product.kind === 'haji' && <HajiFields product={product} maxPeople={maxPeople} onChange={onChange} />}
        {product.kind === 'hotel' && <HotelFields product={product} today={today} maxPeople={maxPeople} onChange={onChange} />}
        {product.kind === 'tour' && <TourFields product={product} today={today} maxPeople={maxPeople} onChange={onChange} />}
        {product.kind === 'muthowif' && <MuthowifFields product={product} today={today} maxPeople={maxPeople} onChange={onChange} />}
        {product.kind === 'catering' && <CateringFields product={product} today={today} maxPeople={maxPeople} onChange={onChange} />}
        {product.kind === 'flight' && <FlightFields product={product} today={today} maxPeople={maxPeople} onChange={onChange} />}
      </div>
      <aside className="min-w-0">
        <CheckoutSummary preview={preview} missing={missing} submitting={submitting} submitError={submitError} onSubmit={submit}>
          {product.kind !== 'haji' && (
            <>
              <button type="button" onClick={addCart} disabled={!input || !!missing} className="btn-brand-outline w-full disabled:opacity-50">
                <ShoppingCart className="h-4 w-4" aria-hidden /> Tambah ke keranjang
              </button>
              {cartNote && (
                <p className={cartNote.ok ? 'flex flex-wrap items-center gap-1.5 text-sm text-brand-dark' : 'text-sm text-destructive'} role="status">
                  {cartNote.ok && <CheckCircle2 className="h-4 w-4 text-brand" aria-hidden />}
                  {cartNote.text}
                  {cartNote.ok && <Link href={`/${locale}/keranjang`} className="font-semibold text-brand hover:underline">Lihat keranjang</Link>}
                </p>
              )}
            </>
          )}
        </CheckoutSummary>
      </aside>
    </div>
  )
}
