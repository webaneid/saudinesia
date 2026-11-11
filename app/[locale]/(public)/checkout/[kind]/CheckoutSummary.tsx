'use client'

import { useTranslations } from 'next-intl'
import { AlertCircle, ArrowRight, FileText, Loader2, UsersRound, Wallet } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { collapseRows, formulaOf } from '@/lib/booking/orderSummary'
import type { PreviewState } from './useCheckoutPreview'

type Props = {
  preview: PreviewState
  /** Isian yang masih kurang (mis. "Pilih tanggal berangkat"), null = lengkap. */
  missing: string | null
  submitting: boolean
  submitError: string
  onSubmit: () => void
  /** Tombol tambahan di bawah tombol pesan (mis. "Tambah ke keranjang"). */
  children?: React.ReactNode
}

// Ringkasan pesanan dari PRATINJAU SERVER (harga jual saja). Tombol pesan hanya aktif bila pratinjau berhasil — angka yang dilihat = angka di invoice.
export function CheckoutSummary({ preview, missing, submitting, submitError, onSubmit, children }: Props) {
  const t = useTranslations('checkout.summary')
  const ready = preview.status === 'ok' && !missing
  return (
    <div className="checkout-panel lg:sticky lg:top-24">
      <h2 className="flex items-center gap-2 text-base font-bold text-brand-dark"><FileText className="h-4 w-4 text-brand" aria-hidden /> {t('title')}</h2>

      {missing ? (
        <p className="rounded-xl bg-brand-light px-3 py-2.5 text-sm text-brand-dark">{missing}</p>
      ) : preview.status === 'loading' || preview.status === 'idle' ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t('calculating')}</p>
      ) : preview.status === 'error' ? (
        <div className="space-y-1.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive" role="alert">
          <p className="flex items-start gap-2 font-semibold"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {preview.message}</p>
          {preview.violations.length > 1 && <ul className="list-disc space-y-0.5 pl-9">{preview.violations.map(v => <li key={v.message}>{v.message}</li>)}</ul>}
        </div>
      ) : (
        <div className="space-y-4">
          <ul className="divide-y text-sm">
            {/* Baris per jamaah yang identik (visa) digabung: "Visa … · 3 jamaah × Rp …"; baris lain tetap satu per item. */}
            {collapseRows(preview.data.lines.map((l, i) => ({
              group: l.group ? `per-jamaah|${l.section ?? ''}` : `baris-${i}`, name: l.group?.label ?? l.label, detail: l.description,
              unit: l.group?.unit ?? '', amount: l.amount, line: l,
            }))).map(r => {
              const formula = formulaOf(r, formatRupiah)
              const line = r.first.line
              return (
                <li key={r.key} className="flex items-start justify-between gap-3 py-2.5 first:pt-0">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{r.name}</p>
                    {r.detail && <p className="text-xs text-muted-foreground">{r.detail}</p>}
                    {formula
                      ? <p className="text-xs text-muted-foreground tabular-nums">{formula}</p>
                      : line.qty > 1 && <p className="text-xs text-muted-foreground tabular-nums">{line.qty} × {formatRupiah(line.unitPrice)}</p>}
                  </div>
                  <span className="shrink-0 font-semibold tabular-nums">{formatRupiah(r.amount)}</span>
                </li>
              )
            })}
          </ul>
          <dl className="space-y-1.5 border-t pt-3 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">{t('subtotal')}</dt><dd className="tabular-nums">{formatRupiah(preview.data.total)}</dd></div>
            {preview.data.tax.filter(x => x.amountIdr > 0).map(x => (
              <div key={x.name} className="flex justify-between">
                <dt className="text-muted-foreground">{x.name} {x.ratePercent}%{x.mode === 'included' ? ` ${t('taxIncluded')}` : ''}</dt>
                <dd className="tabular-nums">{x.mode === 'included' ? '' : formatRupiah(x.amountIdr)}</dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between border-t pt-2">
              <dt className="font-bold text-brand-dark">{t('total')}</dt>
              <dd className="text-xl font-extrabold tabular-nums text-brand">{formatRupiah(preview.data.grandTotal)}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">{t('dueDays', { days: preview.data.dueDays })}</p>
        </div>
      )}

      {submitError && <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive" role="alert">{submitError}</p>}

      <button type="button" onClick={onSubmit} disabled={!ready || submitting} className="btn-brand-solid w-full disabled:opacity-50">
        {submitting ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t('processing')}</> : <>{t('submit')} <ArrowRight className="h-4 w-4" aria-hidden /></>}
      </button>
      {children}

      <div className="space-y-2 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground">{t('afterTitle')}</p>
        <p className="flex gap-2"><UsersRound className="h-4 w-4 shrink-0 text-brand" aria-hidden /> {t('afterPilgrims')}</p>
        <p className="flex gap-2"><Wallet className="h-4 w-4 shrink-0 text-brand" aria-hidden /> {t('afterPay')}</p>
      </div>
    </div>
  )
}
