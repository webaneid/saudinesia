'use client'

import { useCallback, useState } from 'react'
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
import { useCheckoutPreview } from './useCheckoutPreview'

type Props = { locale: string; product: CheckoutProduct; today: string; maxPeople: number; intro: React.ReactNode }

// Orkestrator checkout (docs/arsitektur-booking-engine-v2.md §10.5): isian per jenis → masukan checkout → pratinjau server → pesan (POST /bookings).
// Sukses → detail booking (`?baru=1`) untuk mengisi data jamaah dan membayar.
export function CheckoutForm({ locale, product, today, maxPeople, intro }: Props) {
  const router = useRouter()
  const [input, setInput] = useState<CheckoutInput | null>(null)
  const [missing, setMissing] = useState<string | null>('Lengkapi pilihan pesanan')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const preview = useCheckoutPreview(input)

  const onChange = useCallback((next: CheckoutInput | null, why: string | null) => {
    setInput(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    setMissing(why)
    setSubmitError('')
  }, [])

  async function submit() {
    if (!input) return
    setSubmitting(true)
    setSubmitError('')
    try {
      const res = await fetch('/api/v1/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
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
      </div>
      <aside className="min-w-0">
        <CheckoutSummary preview={preview} missing={missing} submitting={submitting} submitError={submitError} onSubmit={submit} />
      </aside>
    </div>
  )
}
