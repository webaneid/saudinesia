'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle, XCircle, FileSearch } from 'lucide-react'
import { FileViewerDialog } from '@/components/shared/documents/FileViewerDialog'
import { formatRupiah } from '@/lib/utils'

type PendingPayment = {
  id: string
  hasProof: boolean
  /** Nominal yang diisi pelanggan (bukti sebelum Fase 7a: null). */
  claimed: number | null
  /** Sudah diformat di server (zona aplikasi). */
  transferredAt: string | null
  senderBank: string | null
  senderAccountName: string | null
  destination: string | null
  payerNote: string | null
}

interface PaymentActionsProps {
  /** Pembayaran yang menunggu verifikasi; null = tak ada. Komponen tetap terpasang supaya pesan hasil tampil sesudah halaman disegarkan. */
  payment: PendingPayment | null
  /** TAGIHAN (lib/invoice/bill.ts): total, terbayar terverifikasi, sisa. */
  bill: { grandTotal: number; paid: number; balance: number }
  /** Kursi sudah dikonfirmasi (`Booking.confirmedAt`). */
  seatConfirmed: boolean
  /** Terbayar minimal yang mengonfirmasi kursi (`paymentLimits.confirmThreshold`). */
  dpThreshold: number
}

const cents = (n: number) => Math.round(n * 100)

// Verifikasi pembayaran bertahap (Fase 7a F3): jumlah bawaan = nominal pelanggan (atau sisa); kurang dari sisa = cicilan (boleh), kurang dari DP hanya
// diingatkan (P2 — kursi baru dikonfirmasi saat terbayar ≥ DP), lebih dari sisa wajib bercatatan. Aturan sungguhan di lib/payments (server).
export function PaymentActions({ payment, bill, seatConfirmed, dpThreshold }: PaymentActionsProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [done,    setDone]    = useState<{ action: 'confirm' | 'reject'; seat?: boolean; balance?: number } | null>(null)
  const [error,   setError]   = useState('')
  const [amount,  setAmount]  = useState(String(payment?.claimed ?? bill.balance))
  const [notes,   setNotes]   = useState('')
  const [viewing, setViewing] = useState(false) // bukti transfer dilihat di popup, bukan tab baru
  const n = Number(amount)
  const valid = Number.isFinite(n) && n > 0
  const over = valid && cents(n) > cents(bill.balance)
  const partial = valid && cents(n) < cents(bill.balance)
  const paidAfter = bill.paid + (valid ? n : 0)
  const belowDp = !seatConfirmed && valid && cents(paidAfter) < cents(dpThreshold)
  const differsFromClaim = valid && payment?.claimed != null && cents(n) !== cents(payment.claimed)

  async function act(id: string, action: 'confirm' | 'reject') {
    setLoading(true); setError('')
    const res  = await fetch(`/api/v1/admin/payments/${id}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action === 'confirm' ? { action, amount: n, ...(notes.trim() ? { notes: notes.trim() } : {}) } : { action, ...(notes.trim() ? { notes: notes.trim() } : {}) }),
    }).catch(() => null)
    const json = res ? await res.json().catch(() => null) as { success?: boolean; error?: string; data?: { seatConfirmed?: boolean; balance?: number } } | null : null
    setLoading(false)
    if (!json?.success) { setError(json?.error ?? 'Gagal memproses pembayaran'); return }
    setDone({ action, seat: json.data?.seatConfirmed, balance: json.data?.balance })
    router.refresh()
  }

  if (done?.action === 'confirm') {
    const rest = done.balance ?? 0
    return (
      <div role="status" className="admin-card bg-admin-ok/10 border-admin-ok/20 p-4 text-sm text-admin-ok font-medium">
        Pembayaran dikonfirmasi.{done.seat ? ' Kursi pesanan kini terkonfirmasi.' : ''} {rest > 0 ? `Sisa tagihan ${formatRupiah(rest)}.` : 'Tagihan lunas.'}
      </div>
    )
  }
  if (done?.action === 'reject') {
    return <div role="status" className="admin-card bg-admin-danger/10 border-admin-danger/20 p-4 text-sm text-admin-danger font-medium">Pembayaran ditolak. Pelanggan dapat mengunggah bukti baru.</div>
  }
  if (!payment) return null

  const facts: [string, string | null][] = [
    ['Nominal dikirim', payment.claimed != null ? formatRupiah(payment.claimed) : null],
    ['Waktu transfer', payment.transferredAt],
    ['Rekening tujuan', payment.destination],
    ['Bank pengirim', payment.senderBank],
    ['Nama pengirim', payment.senderAccountName],
    ['Catatan pelanggan', payment.payerNote],
  ]

  return (
    <div className="admin-form-panel">
      <p className="text-sm font-semibold text-admin-ink">Verifikasi Pembayaran</p>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-2">
        {facts.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="flex gap-2"><dt className="text-admin-muted">{k}</dt><dd className="font-medium text-admin-ink break-words">{v}</dd></div>
        ))}
        <div className="flex gap-2"><dt className="text-admin-muted">Tagihan</dt><dd className="font-medium text-admin-ink">{formatRupiah(bill.grandTotal)}</dd></div>
        <div className="flex gap-2"><dt className="text-admin-muted">Sudah terverifikasi</dt><dd className="font-medium text-admin-ink">{formatRupiah(bill.paid)} · sisa {formatRupiah(bill.balance)}</dd></div>
      </dl>
      {payment.hasProof && (
        <button type="button" onClick={() => setViewing(true)}
          className="inline-flex items-center gap-1.5 text-[12px] text-admin-accent-strong hover:underline font-medium">
          <FileSearch className="h-3.5 w-3.5" /> Lihat Bukti Transfer
        </button>
      )}
      {viewing && <FileViewerDialog title="Bukti transfer" endpoint={`/api/v1/admin/payments/${payment.id}/bukti`} onClose={() => setViewing(false)} />}
      <div className="space-y-1.5">
        <label className="block text-[12px] font-medium text-admin-muted" htmlFor="pay-amount">Jumlah diterima (Rp)</label>
        <input id="pay-amount" type="number" min={1} className="admin-inp w-full" value={amount} onChange={e => setAmount(e.target.value)} />
        {differsFromClaim && <p className="m-0 text-[11px] text-admin-warning">Berbeda dari nominal yang dikirim pelanggan ({formatRupiah(payment.claimed!)}).</p>}
        {partial && !belowDp && <p className="m-0 text-[11px] text-admin-muted">Pembayaran sebagian — sisa {formatRupiah(bill.balance - n)} setelah dikonfirmasi.</p>}
        {belowDp && <p className="m-0 text-[11px] text-admin-warning">Terbayar akan {formatRupiah(paidAfter)}, di bawah DP {formatRupiah(dpThreshold)} — pembayaran tetap dicatat, tetapi kursi belum dikonfirmasi.</p>}
        {over && <p className="m-0 text-[11px] text-admin-warning">Lebih dari sisa tagihan — catatan wajib (mis. lebih bayar, rencana pengembalian).</p>}
        <textarea className="admin-inp w-full" rows={2} maxLength={500} placeholder={over ? 'Catatan (wajib)' : 'Catatan (opsional)'} value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
      {error && <p className="text-[12px] text-admin-danger">{error}</p>}
      <div className="flex gap-2">
        <button onClick={() => act(payment.id, 'confirm')} disabled={loading || !valid}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-admin-ok hover:bg-admin-ok text-sm text-white font-medium disabled:opacity-50 transition-colors">
          <CheckCircle className="h-4 w-4" /> Konfirmasi
        </button>
        <button onClick={() => act(payment.id, 'reject')} disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-admin-danger hover:bg-admin-danger/90 text-sm text-white font-medium disabled:opacity-50 transition-colors">
          <XCircle className="h-4 w-4" /> Tolak
        </button>
      </div>
    </div>
  )
}
