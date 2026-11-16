'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Banknote, Check, Pencil, Undo2, X } from 'lucide-react'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { DateTimeField } from '@/components/shared/DateTimeField'
import { useConfirm } from '@/components/admin/ui/useConfirm'
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
  cashOptions: Array<{ value: string; label: string }>
}

async function post(url: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
  const json = res ? await res.json().catch(() => null) as { success?: boolean; error?: string } | null : null
  return json?.success ? null : (json?.error ?? 'Gagal menyimpan')
}

// Pembatalan + refund satu booking (Fase 7b-2a §10.10): keputusan tertunda, usulan, setujui/tolak/ubah, bayar (uang keluar → buku kas). Aturan di lib/refunds/service.ts.
export function RefundsPanel({ bookingId, canManage, cancellation, refunds, refundableMax, cashOptions }: Props) {
  const router = useRouter()
  const { ask, dialog } = useConfirm()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<null | { kind: 'propose' } | { kind: 'decide' } | { kind: 'edit'; id: string } | { kind: 'pay'; id: string }>(null)
  const [amount, setAmount] = useState('')
  const [text, setText] = useState('')
  const [decision, setDecision] = useState<'refund' | 'retain'>('refund')
  const [account, setAccount] = useState('')
  const [paidAt, setPaidAt] = useState<string | null>(() => new Date().toISOString())

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
      {dialog}
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
            <li key={r.id} className="py-2 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <span className="font-semibold text-admin-ink tabular-nums">{formatRupiah(r.amount)}</span>
                <span className={STATUS[r.status].cls}>{STATUS[r.status].label}</span>
                <span className="text-admin-muted">{r.source === 'overpayment' ? 'Kelebihan bayar' : 'Pembatalan'} · {r.createdAt}</span>
                {canManage && r.status === 'pending' && (
                  <span className="ml-auto flex gap-1">
                    <button type="button" className="admin-btn-sm" disabled={busy} aria-label="Setujui" onClick={() => run(`/api/v1/admin/refunds/${r.id}`, { action: 'approve' })}><Check className="h-3.5 w-3.5" /> Setujui</button>
                    <button type="button" className="admin-btn-sm" disabled={busy} aria-label="Ubah" onClick={() => open({ kind: 'edit', id: r.id }, String(r.amount), r.reason)}><Pencil className="h-3.5 w-3.5" /></button>
                  </span>
                )}
                {canManage && r.status === 'approved' && (
                  <span className="ml-auto flex gap-1">
                    <button type="button" className="admin-btn-sm" disabled={busy} onClick={() => { open({ kind: 'pay', id: r.id }); setAccount(''); setPaidAt(new Date().toISOString()) }}><Banknote className="h-3.5 w-3.5" /> Bayar</button>
                  </span>
                )}
                {canManage && (r.status === 'pending' || r.status === 'approved') && (
                  <button type="button" className="admin-btn-sm" disabled={busy} aria-label="Tolak" onClick={async () => { if (await ask({ title: 'Tolak refund ini?', confirmLabel: 'Ya, tolak' })) await run(`/api/v1/admin/refunds/${r.id}`, { action: 'reject' }) }}><X className="h-3.5 w-3.5" /></button>
                )}
              </div>
              <p className="m-0 text-[12px] text-admin-muted break-words">{r.reason}{r.paidAt ? ` · dibayar ${r.paidAt}${r.account ? ` dari ${r.account}` : ''}` : ''}{r.notes ? ` · ${r.notes}` : ''}</p>
              {form?.kind === 'edit' && form.id === r.id && (
                <div className="admin-form-panel">
                  <input type="number" min={1} className="admin-inp w-full" aria-label="Jumlah refund" value={amount} onChange={e => setAmount(e.target.value)} />
                  <textarea className="admin-inp w-full" rows={2} maxLength={500} aria-label="Alasan" value={text} onChange={e => setText(e.target.value)} />
                  <div className="flex gap-2">
                    <button type="button" className="admin-btn-sm" disabled={busy} onClick={() => run(`/api/v1/admin/refunds/${r.id}`, { action: 'update', amount: Number(amount), reason: text.trim() })}>Simpan</button>
                    <button type="button" className="admin-btn-sm" onClick={() => setForm(null)}>Tutup</button>
                  </div>
                </div>
              )}
              {form?.kind === 'pay' && form.id === r.id && (
                <div className="admin-form-panel">
                  <ChoiceSelect options={cashOptions.map(o => ({ id: o.value, label: o.label }))} value={account} onChange={setAccount} placeholder="Dibayar dari akun kas" ariaLabel="Akun kas pembayar" clearable={false} />
                  <DateTimeField value={paidAt} onChange={setPaidAt} label="Waktu transfer refund" />
                  <textarea className="admin-inp w-full" rows={2} maxLength={500} placeholder="Catatan (opsional)" value={text} onChange={e => setText(e.target.value)} />
                  <div className="flex gap-2">
                    <button type="button" className="admin-btn-sm" disabled={busy || !account || !paidAt}
                      onClick={async () => { if (await ask({ title: `Catat refund ${formatRupiah(r.amount)} sudah dibayar?`, body: 'Uang keluar dicatat di buku kas dan tidak dapat diubah.', confirmLabel: 'Ya, catat', tone: 'primary' })) await run(`/api/v1/admin/refunds/${r.id}`, { action: 'pay', cashAccount: account, paidAt, ...(text.trim() ? { notes: text.trim() } : {}) }) }}>
                      Catat dibayar
                    </button>
                    <button type="button" className="admin-btn-sm" onClick={() => setForm(null)}>Tutup</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && refundableMax > 0 && form?.kind !== 'propose' && (
        <button type="button" className="admin-btn-sm" onClick={() => open({ kind: 'propose' }, String(refundableMax))}><Undo2 className="h-3.5 w-3.5" /> Usulkan refund (maks. {formatRupiah(refundableMax)})</button>
      )}
      {form?.kind === 'propose' && (
        <div className="admin-form-panel">
          <input type="number" min={1} max={refundableMax} className="admin-inp w-full" aria-label="Jumlah refund" value={amount} onChange={e => setAmount(e.target.value)} />
          <textarea className="admin-inp w-full" rows={2} maxLength={500} placeholder="Alasan (internal)" value={text} onChange={e => setText(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" className="admin-btn-sm" disabled={busy} onClick={() => run(`/api/v1/admin/bookings/${bookingId}/refunds`, { amount: Number(amount), reason: text.trim() })}>Simpan usulan</button>
            <button type="button" className="admin-btn-sm" onClick={() => setForm(null)}>Tutup</button>
          </div>
        </div>
      )}
      {error && <p className="text-[12px] text-admin-danger">{error}</p>}
    </div>
  )
}
