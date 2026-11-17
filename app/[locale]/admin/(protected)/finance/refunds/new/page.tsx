'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { Undo2 } from 'lucide-react'
import { CreatePage } from '@/components/admin/shell/CreatePage'
import { useCreateEntity } from '@/components/admin/shell/useCreateEntity'
import { AutocompleteSelect } from '@/components/shared/AutocompleteSelect'
import { formatRupiah } from '@/lib/utils'
import type { RefundCandidate } from '@/lib/refunds/candidates'
import { EMPTY_RECIPIENT, RecipientFields, recipientPayload, type RecipientValue } from '../RecipientFields'

const STATUS_LABEL: Record<string, string> = { active: 'Aktif', completed: 'Selesai', cancelled: 'Batal', expired: 'Hangus' }

// Buat Refund (SEC-244, docs/arsitektur-booking-engine-v2.md §10.13): pilih booking yang masih punya dana dapat dikembalikan, jumlah ≤ batas (dinilai ulang
// server di dalam kunci), alasan internal, rekening tujuan pelanggan (boleh diisi nanti saat bayar). Sukses → halaman detail refund.
export default function NewRefundPage() {
  return <Suspense><NewRefundForm /></Suspense> // useSearchParams (?booking=) butuh batas Suspense di build produksi
}

function NewRefundForm() {
  const { locale } = useParams() as { locale: string }
  const preset = useSearchParams().get('booking')
  const { saving, error, clearError, submit } = useCreateEntity('/api/v1/admin/refunds', id => `/${locale}/admin/finance/refunds/${id}`, 'Refund gagal dibuat.')
  const [options, setOptions] = useState<RefundCandidate[]>([])
  const [picked, setPicked] = useState<RefundCandidate | null>(null)
  const [loading, setLoading] = useState(false)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [recipient, setRecipient] = useState<RecipientValue>(EMPTY_RECIPIENT)
  const [localError, setLocalError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function load(params: string): Promise<RefundCandidate[]> {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/admin/refunds/candidates?${params}`)
      const json = await res.json().catch(() => null) as { data?: RefundCandidate[] } | null
      return res.ok && json?.data ? json.data : []
    } catch { return [] } finally { setLoading(false) }
  }
  function choose(c: RefundCandidate | null) { clearError(); setPicked(c); setAmount(c ? String(Math.floor(c.max)) : '') }

  useEffect(() => {
    let live = true
    void load(preset && /^[0-9a-f-]{36}$/.test(preset) ? `id=${preset}` : '').then(list => {
      if (!live) return
      setOptions(list)
      if (preset && list[0]?.id === preset) choose(list[0])
    })
    return () => { live = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- dimuat sekali dari parameter awal
  }, [])

  function search(q: string) {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void load(`q=${encodeURIComponent(q)}`).then(list => setOptions(picked && !list.some(o => o.id === picked.id) ? [picked, ...list] : list)) }, 250)
  }

  const amountNum = Number(amount)
  const amountOk = /^\d{1,12}$/.test(amount) && amountNum >= 1 && picked !== null && amountNum <= picked.max

  function onSubmit() {
    const r = recipientPayload(recipient)
    if (r === 'partial') { setLocalError('Lengkapi ketiga kolom rekening tujuan, atau kosongkan semuanya.'); return }
    setLocalError(null)
    return submit({ bookingId: picked?.id, amount: amountNum, reason: reason.trim(), ...(r ? { recipient: r } : {}) })
  }

  return (
    <CreatePage
      icon={Undo2} title="Buat Refund" backHref={`/${locale}/admin/finance/refunds`} backLabel="Daftar Refund"
      description="Mengusulkan pengembalian uang ke pelanggan. Sesudah disimpan: setujui, lalu catat pembayarannya dari halaman detail refund."
      onSubmit={onSubmit} saving={saving} canSubmit={amountOk && reason.trim().length >= 3} error={localError ?? error} submitLabel="Simpan usulan"
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="m-0 text-xs font-semibold text-admin-ink">Booking</p>
          <AutocompleteSelect
            ariaLabel="Booking" placeholder="Cari kode booking / nama pelanggan…" searchPlaceholder="Kode booking atau nama" loading={loading} onSearch={search}
            value={picked?.id ?? null} onChange={id => choose(options.find(o => o.id === id) ?? null)}
            options={options.map(o => ({ id: o.id, label: `${o.code} · ${o.customer}`, short: o.code, hint: `maks. ${formatRupiah(o.max)}` }))}
          />
          <p className="m-0 text-[11px] text-admin-muted">Hanya booking yang masih punya dana dapat dikembalikan: booking batal/hangus (uang masuk) atau booking hidup yang kelebihan bayar.</p>
          {picked && (
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 rounded-xl bg-admin-spot/60 p-3 text-[12px] sm:grid-cols-3">
              <div><dt className="text-admin-muted">Status booking</dt><dd className="m-0 font-medium text-admin-ink">{STATUS_LABEL[picked.status] ?? picked.status}</dd></div>
              <div><dt className="text-admin-muted">Terbayar bersih</dt><dd className="m-0 font-medium tabular-nums text-admin-ink">{formatRupiah(picked.paid)}</dd></div>
              <div><dt className="text-admin-muted">Dapat dikembalikan</dt><dd className="m-0 font-semibold tabular-nums text-admin-ink">{formatRupiah(picked.max)}</dd></div>
            </dl>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-admin-muted">Jumlah refund (Rp)</span>
            <input className="admin-inp" inputMode="numeric" value={amount} disabled={!picked} onChange={e => { clearError(); setAmount(e.target.value.replace(/\D/g, '').slice(0, 12)) }} />
            {picked && amount !== '' && !amountOk && <span className="mt-1 block text-[11px] text-admin-danger">Antara Rp 1 dan {formatRupiah(picked.max)}</span>}
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-admin-muted">Alasan (internal, tidak tampil ke pelanggan)</span>
            <input className="admin-inp" maxLength={500} value={reason} onChange={e => { clearError(); setReason(e.target.value) }} />
          </label>
        </div>

        <div className="space-y-2">
          <p className="m-0 text-xs font-semibold text-admin-ink">Rekening tujuan pelanggan <span className="font-normal text-admin-muted">(boleh diisi nanti — wajib sebelum dibayar, kecuali tunai)</span></p>
          <RecipientFields value={recipient} onChange={v => { setLocalError(null); setRecipient(v) }} />
        </div>
      </div>
    </CreatePage>
  )
}
