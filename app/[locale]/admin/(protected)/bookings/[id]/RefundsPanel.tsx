'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight, Undo2 } from 'lucide-react'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { formatRupiah } from '@/lib/utils'

export type RefundRow = {
  id: string; amount: number; reason: string; status: 'pending' | 'approved' | 'paid' | 'rejected'; source: 'cancellation' | 'overpayment'
  /** Sudah diformat di server (zona aplikasi). */
  createdAt: string; paidAt: string | null; notes: string | null; account: string | null
}
export type CancellationView = {
  cancelledAt: string; byCustomer: boolean; reason: string; paid: number; decision: 'none' | 'refund' | 'retain' | 'defer'; decisionNote: string | null; suggested: number
}

const STATUS: Record<RefundRow['status'], { label: string; cls: string }> = {
  pending:  { label: 'Diusulkan', cls: 'admin-badge-amber' },
  approved: { label: 'Disetujui', cls: 'admin-badge-blue' },
  paid:     { label: 'Dibayar',   cls: 'admin-badge-green' },
  rejected: { label: 'Ditolak',   cls: 'admin-badge-red' },
}
const DECISION_LABEL: Record<CancellationView['decision'], string> = { none: 'Tanpa uang masuk', refund: 'Refund', retain: 'Uang ditahan', defer: 'Belum diputuskan' }

interface Props {
  bookingId: string
  canManage: boolean
  cancellation: CancellationView | null
  refunds: RefundRow[]
  /** Batas usulan refund baru (dibaca server; booking hidup = kelebihan bayar). */
  refundableMax: number
  /** `/{locale}/admin/finance/refunds` — tindakan refund ada di halaman detail (SEC-244, §10.13). */
  refundsHref: string
}

async function post(url: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
  const json = res ? await res.json().catch(() => null) as { success?: boolean; error?: string } | null : null
  return json?.success ? null : (json?.error ?? 'Gagal menyimpan')
}

// Pembatalan + refund satu booking (Fase 7b-2a §10.10): keputusan pembatalan tertunda di sini; refund = ringkasan + tautan — buat/setujui/ubah/tolak/bayar HANYA
// di Keuangan → Refund (SEC-244, §10.13). Aturan di lib/refunds/service.ts.
export function RefundsPanel({ bookingId, canManage, cancellation, refunds, refundableMax, refundsHref }: Props) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<null | { kind: 'decide' }>(null)
  const [amount, setAmount] = useState('')
  const [text, setText] = useState('')
  const [decision, setDecision] = useState<'refund' | 'retain'>('refund')

  if (!cancellation && refunds.length === 0 && (!canManage || refundableMax <= 0)) return null

  async function run(url: string, body: unknown) {
    setBusy(true); setError('')
    const e = await post(url, body)
    setBusy(false)
    if (e) { setError(e); return }
    setForm(null); router.refresh()
  }
  const open = (f: NonNullable<typeof form>, a = '', t = '') => { setForm(f); setAmount(a); setText(t); setError('') }

  return (
    <div className="admin-card p-4 space-y-3">
      <p className="admin-section">Pembatalan &amp; Refund</p>
      {cancellation && (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-2">
          <div className="flex gap-2"><dt className="text-admin-muted">Dibatalkan</dt><dd className="font-medium text-admin-ink">{cancellation.cancelledAt} · {cancellation.byCustomer ? 'oleh pemesan' : 'oleh staf'}</dd></div>
          <div className="flex gap-2"><dt className="text-admin-muted">Uang masuk saat batal</dt><dd className="font-medium text-admin-ink">{formatRupiah(cancellation.paid)}</dd></div>
          <div className="flex gap-2"><dt className="text-admin-muted">Alasan</dt><dd className="font-medium text-admin-ink break-words">{cancellation.reason}</dd></div>
          <div className="flex gap-2"><dt className="text-admin-muted">Keputusan</dt><dd className="font-medium text-admin-ink">{DECISION_LABEL[cancellation.decision]}{cancellation.decisionNote ? ` — ${cancellation.decisionNote}` : ''}</dd></div>
        </dl>
      )}
      {canManage && cancellation?.decision === 'defer' && form?.kind !== 'decide' && (
        <button type="button" className="admin-btn-sm" onClick={() => open({ kind: 'decide' }, String(cancellation.suggested || cancellation.paid))}>Putuskan sekarang</button>
      )}
      {form?.kind === 'decide' && (
        <div className="admin-form-panel">
          <ChoiceSelect options={[{ id: 'refund', label: 'Refund ke pelanggan' }, { id: 'retain', label: 'Tahan uang — catatan wajib' }]} value={decision} onChange={v => setDecision(v as 'refund' | 'retain')} ariaLabel="Keputusan" clearable={false} />
          {decision === 'refund' && <input type="number" min={1} className="admin-inp w-full" aria-label="Jumlah refund" value={amount} onChange={e => setAmount(e.target.value)} />}
          <textarea className="admin-inp w-full" rows={2} maxLength={500} placeholder="Catatan" value={text} onChange={e => setText(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" className="admin-btn-sm" disabled={busy} onClick={() => run(`/api/v1/admin/bookings/${bookingId}/cancel/decision`, { decision, ...(decision === 'refund' ? { refundAmount: Number(amount) } : {}), ...(text.trim() ? { note: text.trim() } : {}) })}>Simpan keputusan</button>
            <button type="button" className="admin-btn-sm" onClick={() => setForm(null)}>Tutup</button>
          </div>
        </div>
      )}

      {refunds.length > 0 && (
        <ul className="divide-y divide-admin-line">
          {refunds.map(r => (
            <li key={r.id} className="py-2">
              <Link href={`${refundsHref}/${r.id}`} className="flex flex-wrap items-center gap-2 text-[12px] hover:text-admin-accent">
                <span className="font-semibold text-admin-ink tabular-nums">{formatRupiah(r.amount)}</span>
                <span className={STATUS[r.status].cls}>{STATUS[r.status].label}</span>
                <span className="text-admin-muted">{r.source === 'overpayment' ? 'Kelebihan bayar' : 'Pembatalan'} · {r.createdAt}</span>
                <span className="ml-auto inline-flex items-center gap-1 font-semibold text-admin-accent">Buka <ArrowRight className="h-3.5 w-3.5" /></span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {canManage && refundableMax > 0 && (
        <Link href={`${refundsHref}/new?booking=${bookingId}`} className="admin-btn-sm"><Undo2 className="h-3.5 w-3.5" /> Buat refund (maks. {formatRupiah(refundableMax)})</Link>
      )}
      {error && <p className="text-[12px] text-admin-danger">{error}</p>}
    </div>
  )
}
