'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Percent } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'

// Penyesuaian TOTAL pesanan — diskon / biaya tambahan (docs/arsitektur-harga-terpadu.md §20, 7B). Hanya saat menunggu pembayaran. `label` tampil di invoice jamaah;
// `catatan` INTERNAL. Catatan wajib bila total akhir di bawah HPP awal (server yang memutuskan; pesan galatnya ditampilkan apa adanya).

type Adj = {
  id: string; amountIdr: number; label: string; reason: string | null; totalBefore: number; totalAfter: number; belowCost: boolean
  reversesId: string | null; reversed: boolean; byName: string | null; createdAt: string
}

export function AdjustmentsPanel({ bookingId, status, totalAmount }: { bookingId: string; status: string; totalAmount: number }) {
  const router = useRouter()
  const editable = status === 'awaiting_payment'
  const [items, setItems] = useState<Adj[]>([])
  const [kind, setKind] = useState<'discount' | 'surcharge'>('discount')
  const [amount, setAmount] = useState('')
  const [label, setLabel] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/admin/bookings/${bookingId}/adjustments`)
    const j = await res.json().catch(() => null)
    if (res.ok && Array.isArray(j?.data)) setItems(j.data)
  }, [bookingId])
  useEffect(() => { void load() }, [load])

  async function submit() {
    setBusy(true); setError('')
    const value = Number(amount)
    const res = await fetch(`/api/v1/admin/bookings/${bookingId}/adjustments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountIdr: kind === 'discount' ? -Math.abs(value) : Math.abs(value), label, ...(reason.trim() ? { reason } : {}) }),
    })
    const j = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) { setError(j?.error ?? 'Gagal menyimpan penyesuaian'); return }
    setAmount(''); setLabel(''); setReason('')
    await load(); router.refresh()
  }

  async function reverse(id: string) {
    setBusy(true); setError('')
    const res = await fetch(`/api/v1/admin/bookings/${bookingId}/adjustments/${id}/reverse`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const j = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) { setError(j?.error ?? 'Gagal membatalkan penyesuaian'); return }
    await load(); router.refresh()
  }

  return (
    <div className="admin-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="admin-section flex items-center gap-1.5"><Percent className="h-3.5 w-3.5" /> Diskon / Penyesuaian Harga</p>
        <p className="m-0 text-[13px] font-bold tabular-nums text-admin-ink">Total: {formatRupiah(totalAmount)}</p>
      </div>

      {editable ? (
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[9rem_1fr_1fr]">
            <select aria-label="Jenis penyesuaian" className="admin-select" value={kind} onChange={e => setKind(e.target.value as 'discount' | 'surcharge')}>
              <option value="discount">Diskon (−)</option>
              <option value="surcharge">Biaya tambahan (+)</option>
            </select>
            <input aria-label="Jumlah (Rp)" type="number" min={1} className="admin-inp" placeholder="Jumlah (Rp)" value={amount} onChange={e => setAmount(e.target.value)} />
            <input aria-label="Label di invoice" className="admin-inp" maxLength={120} placeholder="Label di invoice, mis. Diskon rombongan" value={label} onChange={e => setLabel(e.target.value)} />
          </div>
          <textarea aria-label="Catatan internal" className="admin-inp w-full" rows={2} maxLength={500} placeholder="Catatan internal (wajib bila total akhir di bawah HPP awal)" value={reason} onChange={e => setReason(e.target.value)} />
          <p className="m-0 text-[11px] text-admin-muted">Label tampil di invoice jamaah — jangan menulis nama atau data pribadi. Catatan hanya terlihat admin.</p>
          {error && <p role="alert" className="m-0 text-[12px] font-medium text-admin-danger">{error}</p>}
          <button type="button" disabled={busy || !Number(amount) || !label.trim()} onClick={submit} className="admin-btn-sm">Terapkan</button>
        </div>
      ) : (
        <p className="m-0 text-[12px] text-admin-muted">Total hanya dapat disesuaikan saat pesanan menunggu pembayaran. Setelah dibayar, gunakan jalur refund.</p>
      )}

      {items.length > 0 && (
        <ul className="m-0 list-none divide-y divide-admin-line p-0">
          {items.map(a => (
            <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-[12px]">
              <div className="min-w-0">
                <p className="m-0 font-semibold text-admin-ink">{a.label}{a.reversed && <span className="ml-1.5 text-admin-muted">(dibatalkan)</span>}{a.belowCost && <span className="ml-1.5 rounded bg-admin-danger/10 px-1.5 py-0.5 text-[10px] font-bold text-admin-danger">di bawah HPP</span>}</p>
                <p className="m-0 text-admin-muted">{new Date(a.createdAt).toLocaleString('id-ID')} · {a.byName ?? 'staf'} · total {formatRupiah(a.totalBefore)} → {formatRupiah(a.totalAfter)}</p>
                {a.reason && <p className="m-0 text-admin-muted">Catatan: {a.reason}</p>}
              </div>
              <div className="flex items-center gap-2">
                <span className={`font-bold tabular-nums ${a.amountIdr < 0 ? 'text-admin-danger' : 'text-admin-ok'}`}>{formatRupiah(a.amountIdr)}</span>
                {editable && !a.reversed && !a.reversesId && <button type="button" disabled={busy} onClick={() => reverse(a.id)} className="admin-btn-sm">Batalkan</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
