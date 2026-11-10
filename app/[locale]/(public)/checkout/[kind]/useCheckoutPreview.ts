'use client'

import { useEffect, useState } from 'react'
import type { CheckoutCart } from '@/lib/validators/checkout'
import type { RequiredComponentType } from '@/lib/validators/visa'

// Pratinjau harga dari server (POST /api/v1/bookings/preview) — mesin pesan yang sama dengan saat memesan, di transaksi yang di-rollback.
// Badan = keranjang (`checkoutCartSchema`; checkout satu produk = keranjang satu entri). Dipanggil ulang (jeda 400 ms) setiap isian berubah; permintaan lama dibatalkan. Klien TIDAK menghitung harga sendiri.

export type PreviewLine = { label: string; description: string; qty: number; unitPrice: number; amount: number; group?: { label: string; unit: string } }
export type PreviewData = { lines: PreviewLine[]; total: number; tax: Array<{ name: string; ratePercent: number; mode: string; amountIdr: number }>; taxAdded: number; grandTotal: number; dueDays: number }
/** Pelanggaran aturan visa (lib/booking/rules.ts): jenis komponen yang kurang dipakai halaman keranjang untuk menautkan katalognya. */
export type PreviewViolation = { message: string; missing: RequiredComponentType | 'rule' }
export type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: PreviewData }
  | { status: 'error'; message: string; violations: PreviewViolation[] }

const DELAY_MS = 400

export function useCheckoutPreview(cart: CheckoutCart | null): PreviewState {
  const [state, setState] = useState<PreviewState>({ status: 'idle' })
  const key = cart ? JSON.stringify(cart) : ''

  useEffect(() => {
    if (!key) { setState({ status: 'idle' }); return }
    setState({ status: 'loading' })
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/v1/bookings/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: key, signal: ctrl.signal })
        const json = await res.json() as { success: boolean; data?: PreviewData; error?: string; meta?: { violations?: PreviewViolation[] } }
        if (json.success && json.data) setState({ status: 'ok', data: json.data })
        else setState({ status: 'error', message: json.error ?? 'Harga belum dapat dihitung', violations: (json.meta?.violations ?? []).map(v => ({ message: v.message, missing: v.missing })) })
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setState({ status: 'error', message: 'Gagal menghubungi server — periksa koneksi internet', violations: [] })
      }
    }, DELAY_MS)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [key])

  return state
}
