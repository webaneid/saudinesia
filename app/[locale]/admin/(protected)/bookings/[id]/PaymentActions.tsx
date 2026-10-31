'use client'

import { useState } from 'react'
import { CheckCircle, XCircle, ExternalLink } from 'lucide-react'

interface PaymentActionsProps {
  bookingId: string
  paymentId: string
  buktiPath: string | null
  /** Total TAGIHAN (subtotal + pajak ditambahkan, lib/invoice/bill.ts) — bawaan jumlah yang dikonfirmasi. */
  billTotal: number
}

export function PaymentActions({ bookingId: _, paymentId, buktiPath, billTotal }: PaymentActionsProps) {
  const [loading, setLoading] = useState(false)
  const [done,    setDone]    = useState(false)
  const [error,   setError]   = useState('')
  const [amount,  setAmount]  = useState(String(billTotal))
  const [notes,   setNotes]   = useState('')
  const over = Number(amount) > billTotal
  const under = Number(amount) < billTotal

  async function act(action: 'confirm' | 'reject') {
    setLoading(true); setError('')
    const res  = await fetch(`/api/v1/admin/payments/${paymentId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action === 'confirm' ? { action, amount: Number(amount), ...(notes.trim() ? { notes: notes.trim() } : {}) } : { action }),
    })
    const json = await res.json()
    if (!json.success) { setError(json.error ?? 'Gagal'); setLoading(false); return }
    setDone(true)
  }

  if (done) {
    return (
      <div className="admin-card bg-admin-ok/10 border-admin-ok/20 p-4 text-sm text-admin-ok font-medium">
        Pembayaran berhasil dikonfirmasi.
      </div>
    )
  }

  return (
    <div className="admin-form-panel">
      <p className="text-sm font-semibold text-admin-ink">Verifikasi Pembayaran</p>
      {buktiPath && (
        <a href={`/api/v1/admin/bukti/${encodeURIComponent(buktiPath)}`} target="_blank"
          className="inline-flex items-center gap-1.5 text-[12px] text-admin-accent-strong hover:text-admin-accent-strong font-medium">
          <ExternalLink className="h-3.5 w-3.5" /> Lihat Bukti Transfer
        </a>
      )}
      <div className="space-y-1.5">
        <label className="block text-[12px] font-medium text-admin-muted" htmlFor="pay-amount">Jumlah diterima (Rp)</label>
        <input id="pay-amount" type="number" min={1} className="admin-inp w-full" value={amount} onChange={e => setAmount(e.target.value)} />
        {under && <p className="m-0 text-[11px] text-admin-danger">Kurang dari total pesanan — tidak dapat dikonfirmasi. Tolak pembayaran dan minta pelunasan.</p>}
        {over && (
          <>
            <p className="m-0 text-[11px] text-admin-warning">Lebih dari total pesanan — catatan wajib (mis. lebih bayar, rencana pengembalian).</p>
            <textarea className="admin-inp w-full" rows={2} maxLength={500} placeholder="Catatan" value={notes} onChange={e => setNotes(e.target.value)} />
          </>
        )}
      </div>
      {error && <p className="text-[12px] text-admin-danger">{error}</p>}
      <div className="flex gap-2">
        <button onClick={() => act('confirm')} disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-admin-ok hover:bg-admin-ok text-sm text-white font-medium disabled:opacity-50 transition-colors">
          <CheckCircle className="h-4 w-4" /> Konfirmasi
        </button>
        <button onClick={() => act('reject')} disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-admin-danger hover:bg-admin-danger/90 text-sm text-white font-medium disabled:opacity-50 transition-colors">
          <XCircle className="h-4 w-4" /> Tolak
        </button>
      </div>
    </div>
  )
}
