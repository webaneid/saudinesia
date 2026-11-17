'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Banknote, Check, Pencil, X } from 'lucide-react'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { DateTimeField } from '@/components/shared/DateTimeField'
import { useConfirm } from '@/components/admin/ui/useConfirm'
import { formatRupiah } from '@/lib/utils'
import { EMPTY_RECIPIENT, RecipientFields, recipientPayload, type RecipientValue } from '../RecipientFields'

type Props = {
  refundId: string
  status: 'pending' | 'approved' | 'paid' | 'rejected'
  amount: number
  reason: string
  recipient: RecipientValue | null
  /** Batas jumlah saat ini (dinilai ulang server di dalam kunci saat menyimpan). */
  max: number
  cashOptions: Array<{ value: string; label: string }>
}

// Tindakan refund — SATU tempat (SEC-244, §10.13): Setujui · Ubah (pending) · Tolak · Bayar (uang keluar + buku kas). Aturan & batas di lib/refunds/service.ts.
export function RefundActions({ refundId, status, amount, reason, recipient, max, cashOptions }: Props) {
  const router = useRouter()
  const { ask, dialog } = useConfirm()
  const [mode, setMode] = useState<'none' | 'edit' | 'pay'>('none')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [amt, setAmt] = useState(String(amount))
  const [why, setWhy] = useState(reason)
  const [rec, setRec] = useState<RecipientValue>(recipient ?? EMPTY_RECIPIENT)
  const [account, setAccount] = useState('')
  const [paidAt, setPaidAt] = useState<string | null>(null)
  const [notes, setNotes] = useState('')

  async function run(body: Record<string, unknown>) {
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/v1/admin/refunds/${refundId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => null) as { success?: boolean; error?: string } | null
      if (!res.ok || !json?.success) { setError(json?.error ?? 'Gagal menyimpan'); return }
      setMode('none'); router.refresh()
    } catch { setError('Tidak dapat menghubungi server.') } finally { setBusy(false) }
  }
  function recipientOr(): RecipientValue | null | undefined {
    const r = recipientPayload(rec)
    if (r === 'partial') { setError('Lengkapi ketiga kolom rekening tujuan, atau kosongkan semuanya.'); return undefined }
    return r
  }
  const cashPicked = account === 'cash'

  if (status === 'paid' || status === 'rejected') return <p className="m-0 text-[12px] text-admin-muted">Refund ini sudah {status === 'paid' ? 'dibayar' : 'ditolak'} — tidak ada tindakan lagi.</p>

  return (
    <div className="space-y-3">
      {dialog}
      {mode === 'none' && (
        <div className="flex flex-wrap gap-2">
          {status === 'pending' && (
            <button type="button" className="admin-btn" disabled={busy}
              onClick={async () => { if (await ask({ title: `Setujui refund ${formatRupiah(amount)}?`, body: 'Sesudah disetujui jumlahnya terkunci; langkah berikutnya mencatat pembayaran.', confirmLabel: 'Ya, setujui', tone: 'primary' })) await run({ action: 'approve' }) }}>
              <Check className="size-4" /> Setujui
            </button>
          )}
          {status === 'approved' && (
            <button type="button" className="admin-btn" disabled={busy} onClick={() => { setMode('pay'); setError(''); setAccount(''); setPaidAt(new Date().toISOString()); setNotes('') }}>
              <Banknote className="size-4" /> Bayar refund
            </button>
          )}
          {status === 'pending' && <button type="button" className="admin-btn-ghost text-sm" disabled={busy} onClick={() => { setMode('edit'); setError('') }}><Pencil className="size-4" /> Ubah</button>}
          <button type="button" className="admin-btn-ghost text-sm text-admin-danger" disabled={busy}
            onClick={async () => { if (await ask({ title: 'Tolak refund ini?', body: 'Refund yang ditolak tidak bisa diaktifkan lagi; buat refund baru bila perlu.', confirmLabel: 'Ya, tolak' })) await run({ action: 'reject' }) }}>
            <X className="size-4" /> Tolak
          </button>
        </div>
      )}

      {mode === 'edit' && (
        <div className="admin-form-panel space-y-3">
          <label className="block"><span className="mb-1 block text-xs text-admin-muted">Jumlah (maks. {formatRupiah(max)})</span>
            <input className="admin-inp" inputMode="numeric" value={amt} onChange={e => setAmt(e.target.value.replace(/\D/g, '').slice(0, 12))} /></label>
          <label className="block"><span className="mb-1 block text-xs text-admin-muted">Alasan (internal)</span>
            <input className="admin-inp" maxLength={500} value={why} onChange={e => setWhy(e.target.value)} /></label>
          <RecipientFields value={rec} onChange={setRec} stacked />
          <div className="flex gap-2">
            <button type="button" className="admin-btn-sm" disabled={busy || !/^\d+$/.test(amt) || why.trim().length < 3}
              onClick={() => { const r = recipientOr(); if (r !== undefined) void run({ action: 'update', amount: Number(amt), reason: why.trim(), recipient: r }) }}>Simpan</button>
            <button type="button" className="admin-btn-sm" onClick={() => setMode('none')}>Batal</button>
          </div>
        </div>
      )}

      {mode === 'pay' && (
        <div className="admin-form-panel space-y-3">
          <ChoiceSelect options={cashOptions.map(o => ({ id: o.value, label: o.label }))} value={account} onChange={setAccount} placeholder="Dibayar dari akun kas" ariaLabel="Akun kas pembayar" clearable={false} />
          <DateTimeField value={paidAt} onChange={setPaidAt} label="Waktu transfer refund" />
          {!cashPicked && (
            <div className="space-y-1">
              <p className="m-0 text-xs font-semibold text-admin-ink">Rekening tujuan pelanggan <span className="font-normal text-admin-muted">(wajib kecuali tunai)</span></p>
              <RecipientFields value={rec} onChange={setRec} stacked />
            </div>
          )}
          <textarea className="admin-inp w-full" rows={2} maxLength={500} placeholder="Catatan (opsional, mis. nomor referensi transfer)" value={notes} onChange={e => setNotes(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" className="admin-btn-sm" disabled={busy || !account || !paidAt}
              onClick={async () => {
                const r = cashPicked ? null : recipientOr()
                if (r === undefined) return
                if (!cashPicked && !r) { setError('Isi rekening tujuan pelanggan — wajib kecuali dibayar tunai.'); return }
                if (await ask({ title: `Catat refund ${formatRupiah(amount)} sudah dibayar?`, body: 'Uang keluar dicatat di buku kas dan tidak dapat diubah.', confirmLabel: 'Ya, catat', tone: 'primary' }))
                  await run({ action: 'pay', cashAccount: account, paidAt, ...(notes.trim() ? { notes: notes.trim() } : {}), ...(r ? { recipient: r } : {}) })
              }}>
              Catat dibayar
            </button>
            <button type="button" className="admin-btn-sm" onClick={() => setMode('none')}>Batal</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="m-0 text-[12px] font-medium text-admin-danger">{error}</p>}
    </div>
  )
}
