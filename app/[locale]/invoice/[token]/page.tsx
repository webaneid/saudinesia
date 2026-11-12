import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { FileDown, Landmark } from 'lucide-react'
import { clientIp } from '@/lib/auth/rateLimit'
import { loadPublicInvoice } from '@/lib/invoice/publicView'
import { formatRupiah } from '@/lib/utils'
import { safeLocale } from '@/lib/utils/locale'
import { DATE_SHORT_MONTH_2D, formatCalendarDate } from '@/lib/time'
import { LocaleSwitcher } from '@/components/shared/LocaleSwitcher'

// Invoice PUBLIK tanpa login (docs/arsitektur-booking-engine-v2.md §10.4 6c, K6): siapa pun yang memegang tautan melihat invoice terkini (status, pembayaran, revisi).
// Isi = bentuk invoice yang sama dengan PDF (harga jual beku, pajak, rekening beku, S&K; pembeli lengkap — keputusan pemilik P1). Tanpa HPP/modal/catatan staf/paspor.
// Tautan salah/dicabut → 404 seragam. Header no-store/noindex/no-referrer: next.config.ts. Pembayaran dari halaman ini = Fase 7.
// Bahasa (docs/arsitektur-i18n-frontend.md §6.5): teks halaman, status, dan tanggal ikut bahasa URL; isi baris, kop, rekening, S&K = dokumen beku
// (sama dengan PDF, K5). Pengalih bahasa membawa token di alamat halaman yang SAMA — header no-referrer tetap berlaku.

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ locale: string; token: string }> }

export async function generateMetadata({ params }: Pick<Props, 'params'>): Promise<Metadata> {
  const tm = await getTranslations({ locale: safeLocale((await params).locale), namespace: 'invoicePage' })
  return { title: tm('metaTitle'), robots: { index: false, follow: false }, referrer: 'no-referrer' }
}

const pct = (n: number) => `${Number(n.toFixed(3))}%`

export default async function PublicInvoicePage({ params }: Props) {
  const { locale: raw, token } = await params
  const locale = safeLocale(raw)
  const [t, ts] = await Promise.all([
    getTranslations({ locale, namespace: 'invoicePage' }),
    getTranslations({ locale, namespace: 'shared.bookingStatus' }),
  ])
  const ip = clientIp(new Request('http://invoice.local', { headers: await headers() }))
  const r = await loadPublicInvoice(token, ip)
  if (r.kind === 'not_found') notFound()
  if (r.kind === 'limited') {
    return <main className="mx-auto max-w-xl px-4 py-16 text-center text-sm text-muted-foreground">{t('limited', { minutes: Math.max(1, Math.ceil(r.retryAfterSec / 60)) })}</main>
  }
  const d = r.data
  const c = d.company
  const company = c.name ?? 'Saudinesia'
  const paid = d.balanceDue <= 0 && d.totalAmount > 0
  const day = (v: string) => formatCalendarDate(v, DATE_SHORT_MONTH_2D, locale)

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div className="flex justify-end"><LocaleSwitcher /></div>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
        <div className="space-y-0.5 text-sm text-muted-foreground">
          <p className="text-lg font-bold text-foreground">{company}</p>
          {c.address && <p>{c.address}</p>}
          {c.phone && <p>{t('phone', { phone: c.phone })}</p>}
          {c.email && <p>{c.email}</p>}
          {c.taxId && <p>{t('taxId', { taxId: c.taxId })}</p>}
        </div>
        <div className="space-y-1 text-right">
          <p className="text-2xl font-extrabold tracking-wide">{t('heading')}</p>
          <p className="font-mono text-sm text-muted-foreground">{d.invoiceNumber}</p>
          {d.revision > 1 && <p className="text-xs text-muted-foreground">{t('revision', { number: d.revision })}</p>}
          <span className={`inline-block rounded px-2 py-0.5 text-xs font-bold uppercase ${paid ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>{ts(d.displayStatus)}</span>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-0.5 text-sm">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('billedTo')}</p>
          <p className="font-semibold">{d.buyer.name}</p>
          {d.buyer.address && <p className="text-muted-foreground">{d.buyer.address}</p>}
          {d.buyer.phone && <p className="text-muted-foreground">{d.buyer.phone}</p>}
          {d.buyer.email && <p className="text-muted-foreground">{d.buyer.email}</p>}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:text-right">
          <dt className="text-muted-foreground">{t('bookingCode')}</dt><dd className="font-semibold">{d.bookingCode}</dd>
          <dt className="text-muted-foreground">{t('invoiceDate')}</dt><dd className="font-semibold">{day(d.invoiceDay)}</dd>
          {d.dueDay && <><dt className="text-muted-foreground">{t('dueDate')}</dt><dd className="font-semibold">{day(d.dueDay)}</dd></>}
          <dt className="text-muted-foreground">{t('balanceDue')}</dt><dd className={`text-base font-bold ${d.balanceDue > 0 ? 'text-red-700' : 'text-green-700'}`}>{formatRupiah(d.balanceDue)}</dd>
        </dl>
      </section>

      <section className="rounded-xl border">
        <ul className="divide-y" aria-label={t('lines')}>
          {d.lineItems.map((l, i) => (
            <li key={i}>
            {l.section && l.section !== d.lineItems[i - 1]?.section && <p className="bg-muted/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{l.section}</p>}
            <div className="flex items-start justify-between gap-4 p-4 text-sm">
              <div className="min-w-0">
                <p className="font-semibold">{l.label}</p>
                {l.description && <p className="text-xs text-muted-foreground">{l.description}</p>}
                <p className="text-xs text-muted-foreground">{l.qty} × {formatRupiah(l.unitPrice)}</p>
              </div>
              <p className="shrink-0 font-semibold tabular-nums">{formatRupiah(l.amount)}</p>
            </div>
            </li>
          ))}
        </ul>
        <div className="space-y-1 border-t p-4 text-sm">
          <p className="flex justify-between"><span className="text-muted-foreground">{t('subtotal')}</span><span className="tabular-nums">{formatRupiah(d.subtotal)}</span></p>
          {d.taxLines.map((x, i) => (
            <p key={i} className="flex justify-between"><span className="text-muted-foreground">{x.name} {pct(x.ratePercent)}{x.mode === 'included' ? ` ${t('taxIncluded')}` : ''}</span><span className="tabular-nums">{formatRupiah(x.amountIdr)}</span></p>
          ))}
          <p className="flex justify-between border-t pt-2 text-base font-bold"><span>{t('total')}</span><span className="tabular-nums">{formatRupiah(d.totalAmount)}</span></p>
          {d.paid > 0 && <p className="flex justify-between"><span className="text-muted-foreground">{t('paid')}</span><span className="tabular-nums">{formatRupiah(d.paid)}</span></p>}
          <p className="flex justify-between font-semibold"><span>{t('balanceDue')}</span><span className="tabular-nums">{formatRupiah(d.balanceDue)}</span></p>
        </div>
      </section>

      {d.banks.length > 0 && (
        <section className="space-y-2 rounded-xl border p-4 text-sm">
          <p className="flex items-center gap-1.5 font-semibold"><Landmark className="size-4" aria-hidden /> {t('howToPay')}</p>
          <ul className="space-y-1">
            {d.banks.map(b => (
              <li key={`${b.bankName}-${b.accountNumber}`}>
                {t.rich('transferTo', {
                  bank: b.bankName, account: b.accountNumber, holder: b.accountHolder,
                  b: chunks => <b>{chunks}</b>,
                  mono: chunks => <span className="font-mono">{chunks}</span>,
                })}
                {b.branch ? t('branch', { branch: b.branch }) : ''}
              </li>
            ))}
          </ul>
          <p className="text-xs italic text-muted-foreground">{t('validAfter', { company })}</p>
        </section>
      )}

      {d.terms !== '' && (
        <section className="space-y-1 text-xs text-muted-foreground">
          <p className="font-semibold text-foreground">{t('terms')}</p>
          <p className="whitespace-pre-line">{d.terms}</p>
        </section>
      )}
      {d.footerNote !== '' && <p className="whitespace-pre-line text-xs text-muted-foreground">{d.footerNote}</p>}

      <a href={`/api/v1/invoice/${token}/pdf`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-muted">
        <FileDown className="size-4" aria-hidden /> {t('downloadPdf')}
      </a>
    </main>
  )
}
