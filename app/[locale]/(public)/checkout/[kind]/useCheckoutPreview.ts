'use client'

import { useEffect, useState } from 'react'
import type { CheckoutInput } from '@/lib/validators/checkout'

// Pratinjau harga dari server (POST /api/v1/bookings/preview) — mesin pesan yang sama dengan saat memesan, di transaksi yang di-rollback.
// Dipanggil ulang (jeda 400 ms) setiap isian berubah; permintaan lama dibatalkan. Klien TIDAK menghitung harga sendiri.

export type PreviewLine = { label: string; description: string; qty: number; unitPrice: number; amount: number }
export type PreviewData = { lines: PreviewLine[]; total: number; tax: Array<{ name: string; ratePercent: number; mode: string; amountIdr: number }>; taxAdded: number; grandTotal: number; dueDays: number }
export type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: PreviewData }
  | { status: 'error'; message: string; violations: string[] }

const DELAY_MS = 400

export function useCheckoutPreview(input: CheckoutInput | null): PreviewState {
  const [state, setState] = useState<PreviewState>({ status: 'idle' })
  const key = input ? JSON.stringify(input) : ''

  useEffect(() => {
    if (!key) { setState({ status: 'idle' }); return }
    setState({ status: 'loading' })
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/v1/bookings/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: key, signal: ctrl.signal })
        const json = await res.json() as { success: boolean; data?: PreviewData; error?: string; meta?: { violations?: Array<{ message: string }> } }
        if (json.success && json.data) setState({ status: 'ok', data: json.data })
        else setState({ status: 'error', message: json.error ?? 'Harga belum dapat dihitung', violations: (json.meta?.violations ?? []).map(v => v.message) })
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setState({ status: 'error', message: 'Gagal menghubungi server — periksa koneksi internet', violations: [] })
      }
    }, DELAY_MS)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [key])

  return state
}
