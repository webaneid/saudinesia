import type { LucideIcon } from 'lucide-react'
import { ReceiptText } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { formulaOf, type SummaryRow } from '@/lib/booking/orderSummary'

export type SummarySection = { icon: LucideIcon; title: string; rows: SummaryRow[] }

type Props = {
  sections: SummarySection[]
  /** Diskon/biaya tambahan di total pesanan (tak menempel pada satu layanan). */
  adjustment: number
  taxAdded: number
  grandTotal: number
  invoiceNumber: string | null
}

/** Rincian pesanan ringkas: satu kartu, baris identik digabung dengan rumus ("3 jamaah × Rp …"), lalu total tagihan. */
export function OrderSummaryCard({ sections, adjustment, taxAdded, grandTotal, invoiceNumber }: Props) {
  const shown = sections.filter(s => s.rows.length > 0)
  return (
    <section className="rounded-xl border bg-card p-5 space-y-4" aria-labelledby="rincian-pesanan">
      <h2 id="rincian-pesanan" className="font-semibold flex items-center gap-2"><ReceiptText className="h-4 w-4 text-primary" aria-hidden /> Rincian Pesanan</h2>
      <ul className="divide-y text-sm">
        {shown.flatMap(s => s.rows.map(r => {
          const formula = formulaOf(r, formatRupiah)
          return (
            <li key={r.key} className="flex items-start gap-3 py-3 first:pt-0">
              <s.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{s.title}</p>
                <p className="font-medium">{r.name}</p>
                {r.detail && <p className="text-muted-foreground first-letter:uppercase">{r.detail}</p>}
                {formula && <p className="text-muted-foreground tabular-nums">{formula}</p>}
              </div>
              <p className="shrink-0 font-semibold tabular-nums">{formatRupiah(r.amount)}</p>
            </li>
          )
        }))}
      </ul>
      <dl className="space-y-1.5 border-t pt-3 text-sm">
        {adjustment !== 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Penyesuaian harga</dt>
            <dd className="font-semibold tabular-nums">{adjustment < 0 ? `-${formatRupiah(-adjustment)}` : formatRupiah(adjustment)}</dd>
          </div>
        )}
        {taxAdded > 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Pajak</dt>
            <dd className="tabular-nums">{formatRupiah(taxAdded)}</dd>
          </div>
        )}
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pt-1">
          <dt>
            <span className="font-semibold">Total Tagihan</span>
            {invoiceNumber && <span className="block whitespace-nowrap text-xs text-muted-foreground">Invoice {invoiceNumber}</span>}
          </dt>
          <dd className="ml-auto text-xl font-bold tabular-nums text-primary sm:text-2xl">{formatRupiah(grandTotal)}</dd>
        </div>
      </dl>
    </section>
  )
}
