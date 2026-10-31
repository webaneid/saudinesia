import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { FileDown, Landmark } from 'lucide-react'
import { clientIp } from '@/lib/auth/rateLimit'
import { loadPublicInvoice } from '@/lib/invoice/publicView'
import { formatRupiah } from '@/lib/utils'

// Invoice PUBLIK tanpa login (docs/arsitektur-booking-engine-v2.md §10.4 6c, K6): siapa pun yang memegang tautan melihat invoice terkini (status, pembayaran, revisi).
// Isi = bentuk invoice yang sama dengan PDF (harga jual beku, pajak, rekening beku, S&K; pembeli lengkap — keputusan pemilik P1). Tanpa HPP/modal/catatan staf/paspor.
// Tautan salah/dicabut → 404 seragam. Header no-store/noindex/no-referrer: next.config.ts. Pembayaran dari halaman ini = Fase 7.

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Invoice', robots: { index: false, follow: false } }

type Props = { params: Promise<{ locale: string; token: string }> }

const pct = (n: number) => `${Number(n.toFixed(3))}%`

export default async function PublicInvoicePage({ params }: Props) {
  const { token } = await params
  const ip = clientIp(new Request('http://invoice.local', { headers: await headers() }))
  const r = await loadPublicInvoice(token, ip)
  if (r.kind === 'not_found') notFound()
  if (r.kind === 'limited') {
    return <main className="mx-auto max-w-xl px-4 py-16 text-center text-sm text-muted-foreground">Terlalu banyak permintaan. Coba lagi dalam {Math.max(1, Math.ceil(r.retryAfterSec / 60))} menit.</main>
  }
  const d = r.data
  const c = d.company
  const paid = d.balanceDue <= 0 && d.totalAmount > 0

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
        <div className="space-y-0.5 text-sm text-muted-foreground">
          <p className="text-lg font-bold text-foreground">{c.name ?? 'Saudinesia'}</p>
          {c.address && <p>{c.address}</p>}
          {c.phone && <p>Telp: {c.phone}</p>}
          {c.email && <p>{c.email}</p>}
          {c.taxId && <p>NPWP: {c.taxId}</p>}
        </div>
        <div className="space-y-1 text-right">
          <p className="text-2xl font-extrabold tracking-wide">INVOICE</p>
          <p className="font-mono text-sm text-muted-foreground">{d.invoiceNumber}</p>
          {d.revision > 1 && <p className="text-xs text-muted-foreground">Revisi ke-{d.revision}</p>}
          <span className={`inline-block rounded px-2 py-0.5 text-xs font-bold ${paid ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>{d.statusLabel}</span>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-0.5 text-sm">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Ditagihkan kepada</p>
          <p className="font-semibold">{d.buyer.name}</p>
          {d.buyer.address && <p className="text-muted-foreground">{d.buyer.address}</p>}
          {d.buyer.phone && <p className="text-muted-foreground">{d.buyer.phone}</p>}
          {d.buyer.email && <p className="text-muted-foreground">{d.buyer.email}</p>}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:text-right">
          <dt className="text-muted-foreground">Kode booking</dt><dd className="font-semibold">{d.bookingCode}</dd>
          <dt className="text-muted-foreground">Tanggal invoice</dt><dd className="font-semibold">{d.invoiceDate}</dd>
          {d.dueDate && <><dt className="text-muted-foreground">Jatuh tempo</dt><dd className="font-semibold">{d.dueDate}</dd></>}
          <dt className="text-muted-foreground">Sisa tagihan</dt><dd className={`text-base font-bold ${d.balanceDue > 0 ? 'text-red-700' : 'text-green-700'}`}>{formatRupiah(d.balanceDue)}</dd>
        </dl>
      </section>

      <section className="rounded-xl border">
        <ul className="divide-y" aria-label="Rincian invoice">
          {d.lineItems.map((l, i) => (
            <li key={i} className="flex items-start justify-between gap-4 p-4 text-sm">
              <div className="min-w-0">
                <p className="font-semibold">{l.label}</p>
                {l.description && <p className="text-xs text-muted-foreground">{l.description}</p>}
                <p className="text-xs text-muted-foreground">{l.qty} × {formatRupiah(l.unitPrice)}</p>
              </div>
              <p className="shrink-0 font-semibold tabular-nums">{formatRupiah(l.amount)}</p>
            </li>
          ))}
        </ul>
        <div className="space-y-1 border-t p-4 text-sm">
          <p className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{formatRupiah(d.subtotal)}</span></p>
          {d.taxLines.map((t, i) => (
            <p key={i} className="flex justify-between"><span className="text-muted-foreground">{t.name} {pct(t.ratePercent)}{t.mode === 'included' ? ' (termasuk dalam harga)' : ''}</span><span className="tabular-nums">{formatRupiah(t.amountIdr)}</span></p>
          ))}
          <p className="flex justify-between border-t pt-2 text-base font-bold"><span>Total</span><span className="tabular-nums">{formatRupiah(d.totalAmount)}</span></p>
          {d.paid > 0 && <p className="flex justify-between"><span className="text-muted-foreground">Terbayar</span><span className="tabular-nums">{formatRupiah(d.paid)}</span></p>}
          <p className="flex justify-between font-semibold"><span>Sisa tagihan</span><span className="tabular-nums">{formatRupiah(d.balanceDue)}</span></p>
        </div>
      </section>

      {d.banks.length > 0 && (
        <section className="space-y-2 rounded-xl border p-4 text-sm">
          <p className="flex items-center gap-1.5 font-semibold"><Landmark className="size-4" /> Cara pembayaran</p>
          <ul className="space-y-1">
            {d.banks.map(b => <li key={`${b.bankName}-${b.accountNumber}`}>Transfer ke <b>{b.bankName}</b> <span className="font-mono">{b.accountNumber}</span> a.n. {b.accountHolder}{b.branch ? ` (${b.branch})` : ''}</li>)}
          </ul>
          <p className="text-xs italic text-muted-foreground">Pembayaran dianggap sah setelah dikonfirmasi oleh tim {c.name ?? 'Saudinesia'}.</p>
        </section>
      )}

      {d.terms !== '' && (
        <section className="space-y-1 text-xs text-muted-foreground">
          <p className="font-semibold text-foreground">Syarat & Ketentuan</p>
          <p className="whitespace-pre-line">{d.terms}</p>
        </section>
      )}
      {d.footerNote !== '' && <p className="whitespace-pre-line text-xs text-muted-foreground">{d.footerNote}</p>}

      <a href={`/api/v1/invoice/${token}/pdf`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-muted">
        <FileDown className="size-4" /> Unduh PDF
      </a>
    </main>
  )
}
