'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Ban } from 'lucide-react'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { useConfirm } from '@/components/admin/ui/useConfirm'
import { formatRupiah } from '@/lib/utils'
import { FORCE_MAJEURE_OPTIONS, forceMajeureOf } from '@/lib/refunds/labels'

type Decision = 'refund' | 'retain' | 'defer'
const DECISIONS: Array<{ id: Decision; label: string }> = [
  { id: 'refund', label: 'Refund ke pelanggan (diusulkan, lalu disetujui & dibayar)' },
  { id: 'retain', label: 'Tahan uang (hangus / kompensasi biaya) — catatan wajib' },
  { id: 'defer',  label: 'Putuskan nanti' },
]

interface Props {
  bookingId: string
  /** Terbayar bersih (terverifikasi − refund dibayar). */
  paid: number
  /** Saran refund menurut kebijakan pembatalan. */
  suggested: number
  /** Peran boleh memutuskan uang (manager/superadmin). */
  canMoney: boolean
  /** Ada bukti transfer menunggu verifikasi → pembatalan ditolak server. */
  pendingProof: boolean
}

// Pembatalan oleh staf (Fase 7b-2a §10.10). Aturan sungguhan (kunci booking, batas refund, peran) ada di lib/booking/adminCancel.ts.
export function CancelBookingBox({ bookingId, paid, suggested, canMoney, pendingProof }: Props) {
  const router = useRouter()
  const { ask, dialog } = useConfirm()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [decision, setDecision] = useState<Decision>(suggested > 0 ? 'refund' : 'retain')
  const [amount, setAmount] = useState(String(suggested > 0 ? suggested : paid))
  const [note, setNote] = useState('')
  const [fm, setFm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const money = Math.round(paid * 100) > 0

  if (money && !canMoney) {
    return <p className="admin-card p-4 text-[12px] text-admin-muted">Pesanan ini sudah menerima pembayaran {formatRupiah(paid)} — pembatalan hanya oleh manager/superadmin.</p>
  }
  if (!open) {
    return (
      <div className="flex justify-end">
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-admin-danger/40 px-3 py-1.5 text-[12px] font-medium text-admin-danger hover:bg-admin-danger/10">
          <Ban className="h-3.5 w-3.5" /> Batalkan pesanan
        </button>
      </div>
    )
  }

  const n = Number(amount)
  async function submit() {
    setError('')
    if (reason.trim().length < 3) { setError('Isi alasan pembatalan (minimal 3 karakter)'); return }
    if (!(await ask({ title: 'Batalkan pesanan ini?', body: 'Kuota dilepas dan pelanggan menerima email pemberitahuan. Tindakan ini tidak dapat dibatalkan.', confirmLabel: 'Ya, batalkan' }))) return
    setBusy(true)
    const body = { reason: reason.trim(), ...(money ? { decision, ...(decision === 'refund' ? { refundAmount: n, forceMajeure: forceMajeureOf(fm) } : {}) } : {}), ...(note.trim() ? { note: note.trim() } : {}) }
    const res = await fetch(`/api/v1/admin/bookings/${bookingId}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const json = res ? await res.json().catch(() => null) as { success?: boolean; error?: string } | null : null
    setBusy(false)
    if (!json?.success) { setError(json?.error ?? 'Gagal membatalkan pesanan'); return }
    router.refresh()
  }

  return (
    <div className="admin-form-panel">
      {dialog}
      <p className="text-sm font-semibold text-admin-ink">Batalkan pesanan</p>
      {pendingProof && <p className="m-0 text-[12px] text-admin-warning">Ada bukti transfer menunggu verifikasi — proses dulu pembayarannya.</p>}
      <label className="block text-[12px] font-medium text-admin-muted" htmlFor="cancel-reason">Alasan (internal)</label>
      <textarea id="cancel-reason" className="admin-inp w-full" rows={2} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} />
      {money && (
        <div className="space-y-1.5">
          <p className="m-0 text-[12px] text-admin-ink">Uang masuk: <span className="font-semibold">{formatRupiah(paid)}</span> · saran refund menurut kebijakan: {formatRupiah(suggested)}</p>
          <label className="block text-[12px] font-medium text-admin-muted">Keputusan atas uang</label>
          <ChoiceSelect options={DECISIONS} value={decision} onChange={v => setDecision(v as Decision)} ariaLabel="Keputusan atas uang" clearable={false} />
          {decision === 'refund' && (
            <>
              <label className="block text-[12px] font-medium text-admin-muted" htmlFor="cancel-amount">Jumlah refund (Rp, maks. {formatRupiah(paid)})</label>
              <input id="cancel-amount" type="number" min={1} max={paid} className="admin-inp w-full" value={amount} onChange={e => setAmount(e.target.value)} />
              <label className="block text-[12px] font-medium text-admin-muted">Force-majeure (wajib bila melebihi saran kebijakan)</label>
              <ChoiceSelect ariaLabel="Force-majeure" placeholder="Bukan force-majeure" value={fm} onChange={setFm} options={FORCE_MAJEURE_OPTIONS} />
            </>
          )}
          <textarea className="admin-inp w-full" rows={2} maxLength={500} placeholder={decision === 'retain' ? 'Catatan (wajib)' : 'Catatan (opsional)'} value={note} onChange={e => setNote(e.target.value)} />
        </div>
      )}
      {error && <p className="text-[12px] text-admin-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={busy || pendingProof} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-admin-danger hover:bg-admin-danger/90 text-sm text-white font-medium disabled:opacity-50">
          <Ban className="h-4 w-4" /> Batalkan pesanan
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy} className="admin-btn-sm">Tutup</button>
      </div>
    </div>
  )
}
