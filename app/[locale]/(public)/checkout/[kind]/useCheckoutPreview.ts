'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { CheckoutCart } from '@/lib/validators/checkout'
import type { RequiredComponentType } from '@/lib/validators/visa'
import type { ApiErrorParams } from '@/lib/errors/params'
import { useApiError } from '@/components/shared/useApiError'

// Pratinjau harga dari server (POST /api/v1/bookings/preview) — mesin pesan yang sama dengan saat memesan, di transaksi yang di-rollback.
// Badan = keranjang (`checkoutCartSchema`; checkout satu produk = keranjang satu entri). Dipanggil ulang (jeda 400 ms) setiap isian berubah; permintaan lama dibatalkan. Klien TIDAK menghitung harga sendiri.

export type PreviewLine = { label: string; description: string; qty: number; unitPrice: number; amount: number; group?: { label: string; unit: string }; section?: string }
export type PreviewData = { lines: PreviewLine[]; total: number; tax: Array<{ name: string; ratePercent: number; mode: string; amountIdr: number }>; taxAdded: number; grandTotal: number; dueDays: number }
/** Pelanggaran aturan visa (lib/booking/rules.ts): jenis komponen yang kurang dipakai halaman keranjang untuk menautkan katalognya.
 *  `message` di sini SUDAH diterjemahkan (`useApiError` atas kode pelanggaran). */
export type PreviewViolation = { message: string; missing: RequiredComponentType | 'rule' }
type ServerViolation = { message: string; missing: RequiredComponentType | 'rule'; code?: string; params?: ApiErrorParams }
export type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: PreviewData }
  | { status: 'error'; message: string; violations: PreviewViolation[] }

const DELAY_MS = 400

export function useCheckoutPreview(cart: CheckoutCart | null): PreviewState {
  const t = useTranslations('checkout')
  const errorText = useApiError()
  const [state, setState] = useState<PreviewState>({ status: 'idle' })
  const key = cart ? JSON.stringify(cart) : ''

  useEffect(() => {
    if (!key) { setState({ status: 'idle' }); return }
    setState({ status: 'loading' })
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/v1/bookings/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: key, signal: ctrl.signal })
        const json = await res.json() as { success: boolean; data?: PreviewData; meta?: { violations?: ServerViolation[] } }
        if (json.success && json.data) setState({ status: 'ok', data: json.data })
        else {
          const fallback = t('summary.previewFailed')
          const violations = (json.meta?.violations ?? []).map(v => ({ message: errorText({ error: v.message, meta: { code: v.code, params: v.params } }, fallback), missing: v.missing }))
          setState({ status: 'error', message: errorText(json, fallback), violations })
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setState({ status: 'error', message: t('form.network'), violations: [] })
      }
    }, DELAY_MS)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [key, t, errorText])

  return state
}
