'use client'

import { AlertCircle, ArrowRight, FileText, Loader2, UsersRound, Wallet } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import type { PreviewState } from './useCheckoutPreview'

type Props = {
  preview: PreviewState
  /** Isian yang masih kurang (mis. "Pilih tanggal berangkat"), null = lengkap. */
  missing: string | null
  submitting: boolean
  submitError: string
  onSubmit: () => void
}

// Ringkasan pesanan dari PRATINJAU SERVER (harga jual saja). Tombol pesan hanya aktif bila pratinjau berhasil — angka yang dilihat = angka di invoice.
export function CheckoutSummary({ preview, missing, submitting, submitError, onSubmit }: Props) {
  const ready = preview.status === 'ok' && !missing
  return (
    <div className="checkout-panel lg:sticky lg:top-24">
      <h2 className="flex items-center gap-2 text-base font-bold text-brand-dark"><FileText className="h-4 w-4 text-brand" aria-hidden /> Ringkasan pesanan</h2>

      {missing ? (
        <p className="rounded-xl bg-brand-light px-3 py-2.5 text-sm text-brand-dark">{missing}</p>
      ) : preview.status === 'loading' || preview.status === 'idle' ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Menghitung harga…</p>
      ) : preview.status === 'error' ? (
        <div className="space-y-1.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive" role="alert">
          <p className="flex items-start gap-2 font-semibold"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {preview.message}</p>
          {preview.violations.length > 1 && <ul className="list-disc space-y-0.5 pl-9">{preview.violations.map(v => <li key={v}>{v}</li>)}</ul>}
        </div>
      ) : (
        <div className="space-y-4">
          <ul className="divide-y text-sm">
            {preview.data.lines.map((l, i) => (
              <li key={i} className="flex items-start justify-between gap-3 py-2.5 first:pt-0">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{l.label}</p>
                  {l.description && <p className="text-xs text-muted-foreground">{l.description}</p>}
                  {l.qty > 1 && <p className="text-xs text-muted-foreground">{l.qty} × {formatRupiah(l.unitPrice)}</p>}
                </div>
                <span className="shrink-0 font-semibold tabular-nums">{formatRupiah(l.amount)}</span>
              </li>
            ))}
          </ul>
          <dl className="space-y-1.5 border-t pt-3 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd className="tabular-nums">{formatRupiah(preview.data.total)}</dd></div>
            {preview.data.tax.filter(t => t.amountIdr > 0).map(t => (
              <div key={t.name} className="flex justify-between">
                <dt className="text-muted-foreground">{t.name} {t.ratePercent}%{t.mode === 'included' ? ' (sudah termasuk)' : ''}</dt>
                <dd className="tabular-nums">{t.mode === 'included' ? '' : formatRupiah(t.amountIdr)}</dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between border-t pt-2">
              <dt className="font-bold text-brand-dark">Total</dt>
              <dd className="text-xl font-extrabold tabular-nums text-brand">{formatRupiah(preview.data.grandTotal)}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">Jatuh tempo pembayaran {preview.data.dueDays} hari setelah invoice terbit.</p>
        </div>
      )}

      {submitError && <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive" role="alert">{submitError}</p>}

      <button type="button" onClick={onSubmit} disabled={!ready || submitting} className="btn-brand-solid w-full disabled:opacity-50">
        {submitting ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Memproses…</> : <>Pesan &amp; terbitkan invoice <ArrowRight className="h-4 w-4" aria-hidden /></>}
      </button>

      <div className="space-y-2 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground">Setelah memesan</p>
        <p className="flex gap-2"><UsersRound className="h-4 w-4 shrink-0 text-brand" aria-hidden /> Isi data jamaah — pilih dari Jamaah Saya atau tambah baru.</p>
        <p className="flex gap-2"><Wallet className="h-4 w-4 shrink-0 text-brand" aria-hidden /> Bayar sesuai invoice dan unggah bukti transfer. Pesanan dikonfirmasi setelah pembayaran diverifikasi.</p>
      </div>
    </div>
  )
}
